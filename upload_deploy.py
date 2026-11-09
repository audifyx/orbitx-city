#!/usr/bin/env python3
"""Deploy web/dist to Vercel project orbitx-city via the Vercel MCP:
upload each file with upload_file (returns sha), then create_deployment
referencing the shas. Used because git-based deploys fail here
(no_github_account_connected) and the legacy REST token lacks the team scope.
"""
import sys, os, json, hashlib, base64, subprocess

TEAM_ID = "team_lC1rRnaxRPpyHmiZGxWzS7kY"
PROJECT = "orbitx-city"
DIST = os.path.expanduser("~/workspace/orbitx-city/web/dist")
VERCEL = "/opt/hatch/bin/vercel"


def call_tool(name, args):
    p = subprocess.run(
        [VERCEL, "call-tool", "--name", name,
         "--arguments-json", json.dumps(args)],
        capture_output=True, text=True, timeout=300,
    )
    out = p.stdout.strip()
    if p.returncode != 0:
        print(f"call-tool {name} exit {p.returncode}: {p.stderr[:500]}")
        raise SystemExit(1)
    try:
        d = json.loads(out)
    except json.JSONDecodeError:
        print(f"call-tool {name} non-JSON output: {out[:500]}")
        raise SystemExit(1)
    return d


def main():
    files = []
    for root, _dirs, names in os.walk(DIST):
        for n in names:
            if n == ".gitkeep" or n == "orbitx-city-world.zip":
                # zip is served from GitHub Raw (see data.ts) — not uploaded
                continue
            p = os.path.join(root, n)
            files.append((os.path.relpath(p, DIST), p))
    files.sort()
    print(f"{len(files)} files")

    uploaded = []
    for rel, p in files:
        data = open(p, "rb").read()
        digest = hashlib.sha1(data).hexdigest()
        res = call_tool("upload_file", {
            "teamId": TEAM_ID,
            "contentLength": len(data),
            "xVercelDigest": digest,
            "requestBody": base64.b64encode(data).decode(),
        })
        txt = json.dumps(res)
        # upload_file returns a CloudFront URL whose last segment is the
        # file's sha1 — it must equal the digest we sent.
        import re
        m = re.search(r"/([0-9a-f]{40})(?:\"|$)", txt)
        url_sha = m.group(1) if m else None
        if url_sha and url_sha != digest:
            print(f"upload {rel}: digest mismatch url={url_sha} computed={digest}")
            raise SystemExit(1)
        sha = digest
        if not url_sha:
            # Empty result = file already stored under this digest (dedup);
            # the sha is the content sha1 we computed.
            print(f"  note: {rel} already stored (dedup), using computed sha")
        uploaded.append({"file": rel, "sha": sha, "size": len(data)})
        print(f"  {rel} ({len(data)}B) sha={sha[:12]}")

    dep = call_tool("create_deployment", {
        "teamId": TEAM_ID,
        "requestBody": {
            "name": PROJECT,
            "project": PROJECT,
            "target": "production",
            "files": uploaded,
        },
    })
    print(json.dumps(dep, indent=1)[:1500])


if __name__ == "__main__":
    main()
