// Local OIDC fixture with real RSA signatures, PKCE and one-use authorization codes.
// It never connects to Auth0 and accepts only the isolated test application's URLs.
import { createServer } from "node:http";
import { generateKeyPairSync, sign, createHash, randomUUID } from "node:crypto";
export async function auth0Fixture() {
  const issuer = "http://localhost:4455/",
    audience = "https://kivo.test/api",
    clientId = "kivo-fixture-client",
    clientSecret = "kivo-fixture-secret";
  const keyPair = () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    return {
      privateKey,
      jwk: {
        ...publicKey.export({ format: "jwk" }),
        kid: randomUUID(),
        use: "sig",
        alg: "RS256",
      },
    };
  };
  let key = keyPair(),
    previous;
  const codes = new Map(),
    refreshes = new Map();
  const state = { outage: false, jwksRequests: 0 };
  const users = {
    alice: "alice@studio.test",
    bob: "bob@studio.test",
    carol: "carol@studio.test",
    dave: "dave@studio.test",
    hannah: "hannah@studio.test",
    ian: "ian@studio.test",
    jules: "jules@studio.test",
    kelly: "kelly@studio.test",
    liam: "liam@studio.test",
    erin: "erin@studio.test",
    frank: "frank@studio.test",
    grace: "grace@studio.test",
    unverified: "unverified@studio.test",
  };
  function jwt(claims, header = {}, signingKey = key) {
    const b64 = (value) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const data = `${b64({ alg: "RS256", typ: "JWT", kid: signingKey.jwk.kid, ...header })}.${b64(claims)}`;
    return `${data}.${sign("RSA-SHA256", Buffer.from(data), signingKey.privateKey).toString("base64url")}`;
  }
  function token(user = "alice", claims = {}, header = {}) {
    const now = Math.floor(Date.now() / 1000);
    return jwt(
      {
        iss: issuer,
        sub: `auth0|${user}`,
        aud: [audience, `${issuer}userinfo`],
        iat: now,
        exp: now + 3600,
        "https://kivo.app/email": users[user] ?? `${user}@studio.test`,
        "https://kivo.app/email_verified": user !== "unverified",
        ...claims,
      },
      header,
    );
  }
  function json(res, data, status = 200) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    if (url.pathname === "/.well-known/jwks.json") {
      state.jwksRequests++;
      return json(
        res,
        state.outage
          ? {}
          : { keys: [key.jwk, ...(previous ? [previous.jwk] : [])] },
        state.outage ? 503 : 200,
      );
    }
    if (url.pathname === "/.well-known/openid-configuration")
      return json(res, {
        issuer,
        authorization_endpoint: `${issuer}authorize`,
        token_endpoint: `${issuer}oauth/token`,
        jwks_uri: `${issuer}.well-known/jwks.json`,
        userinfo_endpoint: `${issuer}userinfo`,
        end_session_endpoint: `${issuer}oidc/logout`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: [
          "client_secret_post",
          "client_secret_basic",
        ],
        code_challenge_methods_supported: ["S256"],
      });
    if (url.pathname === "/authorize") {
      const params = url.searchParams;
      if (
        params.get("client_id") !== clientId ||
        params.get("redirect_uri") !== "http://127.0.0.1:3000/auth/callback" ||
        params.get("audience") !== audience
      )
        return json(res, { error: "invalid_request" }, 400);
      const user = params.get("fixture_user");
      if (!users[user]) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          `<!doctype html><html><body><h1>Local sign-in fixture</h1><p>Choose an isolated test account.</p>${Object.keys(
            users,
          )
            .map((u) => {
              const link = new URL(url);
              link.searchParams.set("fixture_user", u);
              return `<p><a href="${link.toString().replaceAll("&", "&amp;")}">Continue as ${u}</a></p>`;
            })
            .join("")}</body></html>`,
        );
        return;
      }
      const code = randomUUID();
      codes.set(code, {
        user,
        nonce: params.get("nonce"),
        challenge: params.get("code_challenge"),
        redirect: params.get("redirect_uri"),
      });
      const redirect = new URL(params.get("redirect_uri"));
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", params.get("state"));
      res.writeHead(302, { Location: redirect.toString() });
      res.end();
      return;
    }
    if (url.pathname === "/oauth/token") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const params = new URLSearchParams(body);
      const basic = Buffer.from(
        (req.headers.authorization ?? "").replace("Basic ", ""),
        "base64",
      ).toString();
      if (
        !(
          params.get("client_id") === clientId &&
          params.get("client_secret") === clientSecret
        ) &&
        basic !== `${clientId}:${clientSecret}`
      )
        return json(res, { error: "invalid_client" }, 401);
      let grant;
      if (params.get("grant_type") === "refresh_token")
        grant = refreshes.get(params.get("refresh_token"));
      else {
        grant = codes.get(params.get("code"));
        codes.delete(params.get("code"));
        if (
          grant &&
          (params.get("redirect_uri") !== grant.redirect ||
            createHash("sha256")
              .update(params.get("code_verifier") ?? "")
              .digest("base64url") !== grant.challenge)
        )
          grant = null;
      }
      if (!grant) return json(res, { error: "invalid_grant" }, 400);
      const refresh = randomUUID();
      refreshes.set(refresh, grant);
      const now = Math.floor(Date.now() / 1000);
      return json(res, {
        token_type: "Bearer",
        access_token: token(grant.user),
        expires_in: 3600,
        scope: "openid profile email offline_access",
        refresh_token: refresh,
        id_token: jwt({
          iss: issuer,
          aud: clientId,
          sub: `auth0|${grant.user}`,
          iat: now,
          exp: now + 3600,
          nonce: grant.nonce,
          name: grant.user,
          email: users[grant.user],
          email_verified: grant.user !== "unverified",
        }),
      });
    }
    if (url.pathname === "/oidc/logout") {
      res.writeHead(302, { Location: "http://127.0.0.1:3000/" });
      res.end();
      return;
    }
    json(res, { error: "not_found" }, 404);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(4455, "127.0.0.1", resolve);
  });
  return {
    issuer,
    audience,
    clientId,
    clientSecret,
    state,
    token,
    rotate() {
      previous = key;
      key = keyPair();
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
