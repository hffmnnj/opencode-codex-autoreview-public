#!/usr/bin/env python3
# /// block
# name = "isolated-runtime"
# summary = "Probe the native OpenCode host in an isolated no-network namespace."
# effects = "exec"
# example = ["--binary", "opencode.exe", "--probe", "smoke"]
# [params]
# binary = { type = "str", required = true, help = "Absolute native OpenCode executable" }
# probe = { type = "str", default = "smoke", help = "smoke (binary) or binding (SDK)" }
# mode = { type = "str", default = "shadow", help = "shadow or enforce for the SDK binding fixture" }
# [returns]
# keys = ["exit", "probe", "output", "run"]
# doc = "Native API result and isolated artifact directory; errors contain error instead."
# [provenance]
# created = "2026-10-18"
# source = "local:offline-runtime-verification"
#
# [stamp]
# verified = "b01c4e6120ae"
# ///
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    parser.add_argument("--probe", choices=["smoke", "binding"], default="smoke")
    parser.add_argument("--mode", choices=["shadow", "enforce"], default="shadow")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    runtime = root / ".verification" / "runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix=args.probe + "-", dir=runtime))
    for name in ["config", "home", "data", "cache", "state", "workspace"]:
        (run / name).mkdir()
    plugins = [{"package": str(root), "options": {"mode": args.mode}}]
    if args.probe == "smoke":
        plugins.append(str(root / "test" / "runtime"))
    config = json.dumps({"update": "disable", "plugins": plugins})
    (run / "config" / "opencode.json").write_text(config)
    (run / "workspace" / "opencode.json").write_text(config)
    env = {"PATH": os.environ["PATH"], "HOME": str(run / "home"),
           "OPENCODE_CONFIG_DIR": str(run / "config"), "XDG_CONFIG_HOME": str(run / "config"),
           "XDG_DATA_HOME": str(run / "data"), "XDG_CACHE_HOME": str(run / "cache"),
           "XDG_STATE_HOME": str(run / "state"), "OPENCODE_DB": str(run / "state" / "opencode.db"),
           "OPENCODE_DISABLE_AUTOUPDATE": "true", "OPENCODE_LOG_LEVEL": "DEBUG",
           "OPENAI_API_KEY": "offline-fixture-not-a-real-key"}
    env["OPENCODE_PROBE_ROOT"] = str(run)
    env["OPENCODE_PROBE_MODE"] = args.mode
    operation = [args.binary, "api", "--standalone", "--print-logs", "rpc.call", "--param", "rpcID=offline-smoke", "--param", "method=run", "--data", '{"input":{}}'] if args.probe == "smoke" else ["bun", str(root / "test" / "runtime" / "sdk.ts")]
    try:
        result = subprocess.run(["unshare", "-Urn", "sh", "-c", 'ip link set lo up && exec "$@"', "offline-host", *operation],
                                cwd=run / "workspace", env=env, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        print(json.dumps({"error": "isolated runtime timed out", "run": str(run.relative_to(root))}))
        return 1
    # Retain only this synthetic process's diagnostics; never read shared host logs.
    (run / "stdout.json").write_text(result.stdout)
    (run / "stderr.log").write_text(result.stderr)
    try:
        output = json.loads(result.stdout)
    except json.JSONDecodeError:
        print(json.dumps({"error": "native probe did not return JSON", "exit": result.returncode, "run": str(run.relative_to(root))}))
        return 1
    print(json.dumps({"exit": result.returncode, "probe": args.probe, "output": output, "run": str(run.relative_to(root))}))
    return 0 if result.returncode == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
