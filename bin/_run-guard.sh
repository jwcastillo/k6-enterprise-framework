# bin/_run-guard.sh — run guard shared by the runners (sourced, not executed).
#
# Two jobs, both independent of the caller's PATH:
#   1. Trusted binaries. k6 (and the node that verifies approvals) are resolved only
#      from the directories listed in the client config key "trustedBinDirs" (searched
#      first) and /usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin (a leading "~/" means the account's
#      home from the password database, not $HOME). A directory or binary that is
#      group/world-writable or owned by someone other than root or the current user is
#      refused. Execution uses the absolute path, with NODE_OPTIONS, BASH_ENV, ENV and
#      the dynamic-loader variables removed.
#   2. Guarded runs. A run is guarded when a scenario gate is unlocked, K6_ALLOW_PROD_LOAD
#      is true, the env is not in "nonProdEnvs" or the profile is in "heavyProfiles"
#      (client config keys; defaults below). A guarded run needs a single-use approval
#      a human creates with bin/approve-run.sh; without one the runner exits 109.
#
# Config lists are read with bash builtins only (the file is the client's default.json
# or config.json). Keep them as plain JSON string arrays.

RG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RG_BASE_DIRS=(/usr/local/bin /usr/bin /bin /opt/homebrew/bin)
RG_NONPROD_DEFAULT="default local dev development test testing qa ci sandbox staging stage uat"
RG_HEAVY_DEFAULT="stress spike breakpoint soak capacity throughput-high throughput-ramp"
EXIT_APPROVAL_REQUIRED=109
# Removed from the environment of every child the guard starts.
RG_ENV_SCRUB=(-u NODE_OPTIONS -u BASH_ENV -u ENV -u LD_PRELOAD -u LD_LIBRARY_PATH -u DYLD_INSERT_LIBRARIES -u DYLD_LIBRARY_PATH)

# Client config file that carries the policy keys: <dir>/config/default.json, else <dir>/config.json.
rg_policy_file() {
  if [[ -f "$1/config/default.json" ]]; then echo "$1/config/default.json"; else echo "$1/config.json"; fi
}

# rg_config_list <file> <key> — print the string array <key> one item per line; 1 when absent.
rg_config_list() {
  local file="$1" key="$2" content body item
  local -a items
  [[ -f "${file}" ]] || return 1
  content="$(<"${file}")"
  local re="\"${key}\"[[:space:]]*:[[:space:]]*\\[([^]]*)\\]"
  [[ "${content}" =~ ${re} ]] || return 1
  body="${BASH_REMATCH[1]//$'\n'/ }"
  IFS=',' read -ra items <<< "${body}"
  for item in ${items[@]+"${items[@]}"}; do
    item="${item#"${item%%[![:space:]]*}"}"; item="${item%"${item##*[![:space:]]}"}"
    item="${item#\"}"; item="${item%\"}"
    [[ -n "${item}" ]] && printf '%s\n' "${item}"
  done
  return 0
}

# 0 when <path> is owned by root or the current user and not group/world-writable.
rg_safe_path() {
  local PATH="/usr/bin:/bin"
  [[ -e "$1" ]] || return 1
  if [[ -z "$(find -H "$1" -maxdepth 0 \( -perm -0020 -o -perm -0002 \) 2>/dev/null)" ]] \
    && [[ -n "$(find -H "$1" -maxdepth 0 \( -user 0 -o -user "$(id -u)" \) 2>/dev/null)" ]]; then
    return 0
  fi
  # Hosted CI runners are single-user VMs that ship world-writable tool dirs. There the
  # permission check only warns; the directory allowlist and absolute-path execution
  # still apply. Setting CI=true gives a same-user process nothing it could not already
  # do by writing to a user-owned trusted directory.
  if [[ "${CI:-}" == "true" ]]; then
    echo "[run-guard] CI: accepting $1 despite its permissions ($(_rg_mode "$1"))" >&2
    return 0
  fi
  return 1
}

# "<mode> uid=<n> gid=<n>" of a path, for diagnostics.
_rg_mode() {
  local PATH="/usr/bin:/bin" m
  m="$(ls -ldLn -- "$1" 2>/dev/null)" || { echo "missing"; return 0; }
  set -- ${m}
  echo "$1 uid=$3 gid=$4"
}

# rg_trusted_dirs <policy file> [extra dirs...] — sets RG_TRUSTED_DIRS and RG_SAFE_PATH.
rg_trusted_dirs() {
  local PATH="/usr/bin:/bin"
  local policy="$1" d home="" user
  shift
  user="$(id -un)"
  [[ "${user}" =~ ^[A-Za-z0-9._-]+$ ]] && home="$(eval "printf '%s' ~${user}")"
  RG_TRUSTED_DIRS=()
  # Configured dirs first (reviewed, in-repo config), then the system defaults.
  local -a candidates=()
  while IFS= read -r d; do candidates+=("${d}"); done < <(rg_config_list "${policy}" trustedBinDirs || true)
  candidates+=("$@" "${RG_BASE_DIRS[@]}")
  for d in "${candidates[@]}"; do
    [[ "${d}" == "~/"* && -n "${home}" ]] && d="${home}/${d#\~/}"
    [[ "${d}" == /* && -d "${d}" ]] || continue
    if rg_safe_path "${d}"; then
      RG_TRUSTED_DIRS+=("${d%/}")
    else
      echo "[run-guard] ignoring trusted dir ${d}: group/world-writable or foreign owner ($(_rg_mode "${d}"))" >&2
    fi
  done
  RG_SAFE_PATH="$(IFS=:; echo "${RG_TRUSTED_DIRS[*]}")"
}

# rg_resolve_bin <name> — absolute (realpath) of <name> found in RG_TRUSTED_DIRS; 1 if none.
rg_resolve_bin() {
  local PATH="/usr/bin:/bin"
  local d real
  for d in "${RG_TRUSTED_DIRS[@]}"; do
    [[ -f "${d}/$1" && -x "${d}/$1" ]] || continue
    real="$(realpath "${d}/$1" 2>/dev/null)" || continue
    if rg_safe_path "${d}/$1" && rg_safe_path "${real}" && rg_safe_path "$(dirname "${real}")"; then
      printf '%s\n' "${real}"
      return 0
    fi
    echo "[run-guard] refusing ${d}/$1: group/world-writable or foreign owner ($(_rg_mode "${d}/$1"); target $(_rg_mode "${real}"))" >&2
  done
  return 1
}

# rg_k6_binary [extra dirs...] — absolute k6 to execute. Honors K6_BINARY_PATH when it
# sits in a trusted dir or one of the extra dirs (the K6_BINARY_ALLOWED_PATHS env var is
# no longer read: list dirs in trustedBinDirs).
rg_k6_binary() {
  local PATH="/usr/bin:/bin"
  local real d
  local -a allowed=("${RG_TRUSTED_DIRS[@]}" "$@")
  if [[ -n "${K6_BINARY_ALLOWED_PATHS:-}" ]]; then
    echo "[run-guard] K6_BINARY_ALLOWED_PATHS is ignored; list trusted dirs in the client config trustedBinDirs" >&2
  fi
  if [[ -z "${K6_BINARY_PATH:-}" ]]; then
    rg_resolve_bin k6 && return 0
    echo "[run-guard] k6 not found in a trusted directory (${RG_SAFE_PATH}). Install it there or add its directory to trustedBinDirs." >&2
    return 1
  fi
  real="$(realpath "${K6_BINARY_PATH}" 2>/dev/null)" || { echo "[run-guard] K6_BINARY_PATH does not exist" >&2; return 1; }
  for d in "${allowed[@]}"; do
    if [[ "${real}" == "${d}/"* ]] && [[ -f "${real}" && -x "${real}" ]] && rg_safe_path "${real}"; then
      printf '%s\n' "${real}"
      return 0
    fi
  done
  echo "[run-guard] K6_BINARY_PATH '${K6_BINARY_PATH}' is not an executable in a trusted directory (${RG_SAFE_PATH})" >&2
  return 1
}

# rg_gate_kind <scenario .ts> — prints quarantined|experimental|unsafe, or nothing.
rg_gate_kind() {
  local content re='export const gate = "(quarantined|experimental|unsafe)"'
  [[ -f "$1" ]] || return 0
  content="$(<"$1")"
  [[ "${content}" =~ ${re} ]] && printf '%s\n' "${BASH_REMATCH[1]}"
  return 0
}

_rg_lower() { local PATH="/usr/bin:/bin"; printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

_rg_in_list() { # <word> <list...>
  local w x
  w="$(_rg_lower "$1")"; shift
  for x in "$@"; do [[ "$(_rg_lower "${x}")" == "${w}" ]] && return 0; done
  return 1
}

# rg_classify <gate kind> <profile> <env> <policy file> — sets RG_REASONS (empty = not guarded).
rg_classify() {
  local gate="$1" profile="$2" env="$3" policy="$4" list
  RG_REASONS=()
  [[ -n "${gate}" ]] && RG_REASONS+=("gated scenario ('${gate}')")
  [[ "${K6_ALLOW_PROD_LOAD:-}" == "true" ]] && RG_REASONS+=("K6_ALLOW_PROD_LOAD=true")
  list="$(rg_config_list "${policy}" nonProdEnvs)" || list="${RG_NONPROD_DEFAULT}"
  # shellcheck disable=SC2086
  _rg_in_list "${env}" ${list} || RG_REASONS+=("env '${env}' is not in nonProdEnvs")
  list="$(rg_config_list "${policy}" heavyProfiles)" || list="${RG_HEAVY_DEFAULT}"
  # shellcheck disable=SC2086
  _rg_in_list "${profile}" ${list} && RG_REASONS+=("profile '${profile}' is heavy")
  return 0
}

# rg_approval <check|consume> <root> <client> <scenario> <profile> <env>
# check: exit 109 with instructions when no valid approval exists.
# consume: marks it used and prints the approval record (JSON) on stdout.
rg_approval() {
  local mode="$1" root="$2" client="$3" scenario="$4" profile="$5" env="$6" node r
  if ! node="$(rg_resolve_bin node)"; then
    echo "[run-guard] node not found in a trusted directory (${RG_SAFE_PATH}); approvals cannot be verified. Add its directory to trustedBinDirs." >&2
    exit 107
  fi
  if /usr/bin/env "${RG_ENV_SCRUB[@]}" -u NODE_PATH PATH="${RG_SAFE_PATH}" "${node}" "${RG_DIR}/_run-approval.js" "${mode}" \
      --root="${root}" --client="${client}" --scenario="${scenario}" --profile="${profile}" --env="${env}"; then
    return 0
  fi
  {
    echo ""
    echo "[APPROVAL REQUIRED] This is a guarded run:"
    for r in "${RG_REASONS[@]}"; do echo "    - ${r}"; done
    echo "  No valid, unused human approval matches client=${client} scenario=${scenario} profile=${profile} env=${env}."
    echo "  A human must run, in their own terminal:"
    echo "    ./bin/approve-run.sh --client=${client} --scenario=${scenario} --profile=${profile} --env=${env} --reason=\"...\""
    echo "  then rerun this command. AI agents: stop and ask the human; never run approve-run.sh yourself."
    echo "  CI: guarded runs are not supported without a local approval record (fail closed)."
  } >&2
  exit "${EXIT_APPROVAL_REQUIRED}"
}
