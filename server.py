import asyncio
import importlib.util
import json
import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).parent
sys.path[:] = [entry for entry in sys.path if Path(entry or ".").resolve() != ROOT.resolve()]
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


PACKAGE_NAME = "codwrapper"
spec = importlib.util.spec_from_file_location(
    PACKAGE_NAME,
    ROOT / "__init__.py",
    submodule_search_locations=[str(ROOT)],
)
codwrapper = importlib.util.module_from_spec(spec)
sys.modules[PACKAGE_NAME] = codwrapper
spec.loader.exec_module(codwrapper)


def get_profile(query):
    email = os.getenv("COD_EMAIL")
    password = os.getenv("COD_PASSWORD")
    sso = os.getenv("COD_SSO")
    if not sso and not (email and password):
        raise RuntimeError("Set COD_SSO or COD_EMAIL and COD_PASSWORD first")

    username = query.get("username", [""])[0].strip()
    if not username:
        raise ValueError("A player username is required")

    platform = codwrapper.Platform(query.get("platform", ["uno"])[0])
    title = codwrapper.Title(query.get("title", ["mw"])[0])
    mode = codwrapper.Mode(query.get("mode", ["zm"])[0])

    async def request():
        client = await codwrapper.Login(email=email, password=password, sso=sso)
        player = await client.GetPlayer(platform, username)
        return await player.profile(title, mode)

    return asyncio.run(request())


class WebsiteHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/cod/profile":
            return super().do_GET()

        try:
            payload = {"ok": True, "profile": get_profile(parse_qs(parsed.query))}
            status = 200
        except (ValueError, RuntimeError) as error:
            payload = {"ok": False, "error": str(error)}
            status = 400
        except Exception:
            payload = {"ok": False, "error": "Call of Duty API request failed"}
            status = 502

        body = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", int(os.getenv("PORT", "4173"))), WebsiteHandler)
    print(f"Night Shift Arcade running at http://127.0.0.1:{server.server_port}")
    server.serve_forever()