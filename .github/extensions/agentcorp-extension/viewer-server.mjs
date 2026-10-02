import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshot, validPresenceIds } from "./observations.mjs";
import { readPreferences, savePreference, validatePreferenceUpdate } from "./viewer-preferences.mjs";

const viewer = resolve(dirname(fileURLToPath(import.meta.url)), "viewer");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

function readPreferenceBody(request) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    request.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > 256) { reject(new Error("Preference body exceeds 256 bytes.")); return; }
      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      try { resolve(validatePreferenceUpdate(JSON.parse(Buffer.concat(chunks).toString("utf8")))); }
      catch (error) { reject(error); }
    });
  });
}

export async function startServer(root) {
  const server = createServer(async (request, response) => {
    try {
      const address = server.address();
      if (!address || typeof address === "string" || request.headers.host !== `127.0.0.1:${address.port}`) {
        response.writeHead(403); response.end(); return;
      }
      const requestUrl = new URL(request.url ?? "/", `http://127.0.0.1:${address.port}`);
      const path = requestUrl.pathname;
      if (path === "/api/preferences") {
        if (requestUrl.search) { response.writeHead(400); response.end("No preference query parameters allowed."); return; }
        if (request.method !== "GET" && request.method !== "PUT") {
          response.writeHead(405); response.end(); return;
        }
        let update;
        if (request.method === "PUT") {
          if (request.headers.origin !== `http://127.0.0.1:${address.port}` ||
            (request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin")) {
            response.writeHead(403); response.end("Same-origin preference changes only."); return;
          }
          if (request.headers["content-type"] !== "application/json") {
            response.writeHead(415); response.end("JSON required."); return;
          }
          try { update = await readPreferenceBody(request); }
          catch {
            response.writeHead(400); response.end("Invalid office preference (maximum 256 bytes)."); return;
          }
        }
        try {
          const preferences = update ? await savePreference(update) : await readPreferences();
          response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          response.end(JSON.stringify(preferences));
        } catch (error) {
          console.error("AgentCorp preferences failed:", error);
          response.writeHead(500); response.end("Office preferences could not be read or saved.");
        }
        return;
      }
      if (request.method !== "GET") { response.writeHead(405); response.end(); return; }
      if (path === "/api/observations") {
        let presenceIds;
        if (requestUrl.searchParams.has("presence")) {
          try {
            presenceIds = validPresenceIds(requestUrl.searchParams.getAll("presence"));
          } catch {
            response.writeHead(400); response.end("Invalid presence ID list."); return;
          }
        }
        const observation = await snapshot(root, Date.now(), presenceIds);
        response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify(observation));
        return;
      }
      const target = resolve(viewer, `.${path === "/" ? "/observe.html" : path}`);
      if (!target.startsWith(viewer + sep)) { response.writeHead(404); response.end(); return; }
      const body = await readFile(target);
      response.writeHead(200, { "Content-Type": mime[extname(target)] ?? "application/octet-stream", "X-Content-Type-Options": "nosniff" });
      response.end(body);
    } catch (error) {
      if (error?.code === "ENOENT") { response.writeHead(404); response.end("Build the viewer with npm run package:observer."); return; }
      console.error("AgentCorp viewer request failed:", error);
      response.writeHead(500); response.end("Office update unavailable.");
    }
  });
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}
