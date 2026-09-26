// Tiny multi-step site for the discover-flow end-to-end test.
//   /        -> link "Start"
//   /form    -> plate + email; "Search" posts /api/search (returns a token), then
//               GET /api/offers?token=<token> (the correlation), then /results
//   /results -> "Pay now" button (must never be clicked) and "Continue" link to /pay
//   /pay     -> the --stop-at boundary; "Confirm" would POST /api/pay
"use strict";

const http = require("http");
const crypto = require("crypto");

const page = (title, body) =>
  `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;

const PAGES = {
  "/": page("Welcome", '<a href="/form">Start</a>'),
  "/form": page(
    "Search",
    `<form onsubmit="return false">
      <label for="plate">Plate</label><input id="plate" name="plate">
      <label for="email">Email</label><input id="email" name="email" type="email">
      <button type="button" id="go">Search</button>
    </form>
    <script>
      document.getElementById("go").onclick = async () => {
        const body = JSON.stringify({ plate: plate.value, email: email.value });
        const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body });
        const { session } = await res.json();
        await fetch("/api/offers?token=" + encodeURIComponent(session.token));
        location.href = "/results";
      };
    </script>`
  ),
  "/results": page(
    "Results",
    `<p>3 offers found.</p>
    <button onclick="fetch('/api/pay', { method: 'POST' })">Pay now</button>
    <a href="/pay">Continue</a>`
  ),
  "/pay": page("Payment", `<button onclick="fetch('/api/pay', { method: 'POST' })">Confirm</button>`),
};

function start() {
  const state = { payCalls: 0, tokens: [], offersToken: null };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const json = (obj) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.method === "POST" && url.pathname === "/api/search") {
      const token = crypto.randomBytes(16).toString("hex");
      state.tokens.push(token);
      return json({ session: { token }, count: 3 });
    }
    if (url.pathname === "/api/offers") {
      state.offersToken = url.searchParams.get("token");
      return json({ offers: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    }
    if (url.pathname === "/api/pay") {
      state.payCalls++;
      return json({ paid: true });
    }
    if (PAGES[url.pathname]) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(PAGES[url.pathname]);
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "localhost", () => {
      resolve({
        url: `http://localhost:${server.address().port}/`,
        state,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

module.exports = { start };
