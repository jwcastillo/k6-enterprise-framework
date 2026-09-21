# cmd/k6-embedded

Go module that embeds compiled k6 JS bundles and optional data files into a
self-contained binary using `//go:embed`. Built by `bin/build-binary.sh`.

## TUI output extension

Custom binaries built by `./bin/build-binary.sh` include the
`xk6-output-tui` extension wired in via a blank import in
`entrypoint/main.go.tpl`. The extension self-registers the `tui` output
via its `init()` function.

```
<binary> run --out tui embedded://<script>
```

> **Availability:** the embedded build targets `go.k6.io/k6/v2 v2.0.0`, the
> same module path `xk6-output-tui` requires, so the extension registers its
> `tui` output and `--out tui` works out of the box in the custom binary.

## Build

```bash
./bin/build-binary.sh --client <name>
# e.g.
./bin/build-binary.sh --client examples
./bin/build-binary.sh --client examples --platform linux/amd64
```

Output: `dist/binaries/<client>/<os>_<arch>/k6-<client>`

## Runtime

```bash
k6-<client> list-scripts
k6-<client> run embedded://<script-path>
k6-<client> run --out tui embedded://<script-path>   # once k6/v2 migration lands
```
