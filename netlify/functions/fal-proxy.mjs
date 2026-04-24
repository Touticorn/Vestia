// Netlify Function: fal.ai proxy (matches official @fal-ai/server-proxy spec)
// Securely forwards requests from the browser fal client to fal.ai with FAL_KEY attached.
// Spec: https://docs.fal.ai/model-endpoints/server-side/

const TARGET_URL_HEADER = "x-fal-target-url";
const FAL_URL_REGEX = /^https:\/\/[\w-]+\.fal\.(ai|run)(\/.*)?$/;
const ALLOWED_METHODS = ["GET", "POST", "PUT", "OPTIONS"];

export default async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-fal-target-url, accept",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (!ALLOWED_METHODS.includes(req.method)) {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: cors({ "Content-Type": "application/json" }),
    });
  }

  const FAL_KEY = Netlify.env.get("FAL_KEY");
  if (!FAL_KEY) {
    return new Response(JSON.stringify({ error: "FAL_KEY not configured on server. Add it in Netlify Site Settings → Environment Variables." }), {
      status: 500,
      headers: cors({ "Content-Type": "application/json" }),
    });
  }

  const targetUrl = req.headers.get(TARGET_URL_HEADER);
  if (!targetUrl) {
    return new Response(JSON.stringify({ error: "Missing x-fal-target-url header" }), {
      status: 400,
      headers: cors({ "Content-Type": "application/json" }),
    });
  }

  if (!FAL_URL_REGEX.test(targetUrl)) {
    return new Response(JSON.stringify({ error: "Target URL must point to *.fal.ai or *.fal.run" }), {
      status: 412,
      headers: cors({ "Content-Type": "application/json" }),
    });
  }

  // Forward headers
  const fwdHeaders = new Headers();
  fwdHeaders.set("Authorization", `Key ${FAL_KEY}`);
  fwdHeaders.set("x-fal-client-proxy", "vestia-netlify/1.0");
  const ct = req.headers.get("content-type");
  if (ct) fwdHeaders.set("Content-Type", ct);
  const accept = req.headers.get("accept");
  if (accept) fwdHeaders.set("Accept", accept);

  // Body for non-GET requests
  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.arrayBuffer();
    if (body.byteLength === 0) body = undefined;
  }

  try {
    const proxyRes = await fetch(targetUrl, {
      method: req.method,
      headers: fwdHeaders,
      body,
    });

    const respHeaders = new Headers();
    proxyRes.headers.forEach((value, key) => {
      // Skip headers that can break re-encoding
      const lower = key.toLowerCase();
      if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(lower)) {
        respHeaders.set(key, value);
      }
    });
    respHeaders.set("Access-Control-Allow-Origin", "*");
    respHeaders.set("Access-Control-Expose-Headers", "*");

    return new Response(proxyRes.body, {
      status: proxyRes.status,
      statusText: proxyRes.statusText,
      headers: respHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Proxy fetch failed", detail: String(err.message || err) }), {
      status: 502,
      headers: cors({ "Content-Type": "application/json" }),
    });
  }
};

function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    ...extra,
  };
}

export const config = {
  path: "/api/fal/proxy",
};
