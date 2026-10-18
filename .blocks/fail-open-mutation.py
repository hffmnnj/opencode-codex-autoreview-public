#!/usr/bin/env python3
# /// block
# name = "fail-open-mutation"
# summary = "Prove HTTP failure auto-allow is caught in an isolated copy, then restore green."
# effects = "exec"
# example = ["--fault", "http-error-allow"]
# [params]
# fault = { type = "str", default = "http-error-allow", help = "Named production fault (http-error-allow)" }
# [returns]
# keys = ["baseline", "mutant", "restored", "fault", "run"]
# doc = "Green/red/green focused behavioral evidence; never edits production sources."
# [provenance]
# created = "2026-10-18"
# source = "local:fail-open-regression"
#
# [stamp]
# verified = "47894c62f9cc"
# ///
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fault", choices=["http-error-allow"], default="http-error-allow")
    parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    base = root / ".verification" / "mutation"
    base.mkdir(parents=True, exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix="fail-open-", dir=base))
    for name in ["src", "test"]:
        shutil.copytree(root / name, run / name)
    for name in ["package.json", "tsconfig.json", "tsconfig.test.json"]:
        shutil.copyfile(root / name, run / name)
    (run / "node_modules").symlink_to(root / "node_modules", target_is_directory=True)
    path = run / "src" / "native.ts"
    original = path.read_text()
    good = 'if (result.status !== "assessed") { this.report(result.status); return; }'
    bad = 'if (result.status !== "assessed") { event.effect = "allow"; this.report(result.status); return; }'
    if original.count(good) != 1:
        raise ValueError("mutation boundary changed; inspect before updating fault")
    command = [str(root / "node_modules" / ".bin" / "tsx"), "--test", "--test-reporter=tap",
               "--test-name-pattern=HTTP failure retains manual ask", "test/native.test.ts"]
    def check(label):
        result = subprocess.run(command, cwd=run, capture_output=True, text=True, timeout=30)
        (run / (label + ".tap")).write_text(result.stdout + result.stderr)
        return result
    baseline = check("baseline")
    if baseline.returncode != 0:
        raise ValueError("baseline failed; not mutation evidence")
    path.write_text(original.replace(good, bad))
    try:
        mutant = check("mutant")
    finally:
        path.write_text(original)
    restored = check("restored")
    if mutant.returncode == 0 or "actual: 'allow'" not in mutant.stdout or "expected: 'ask'" not in mutant.stdout:
        raise ValueError("named fault not detected at the expected permission-effect assertion")
    if restored.returncode != 0:
        raise ValueError("restoration failed")
    print(json.dumps({"baseline": "green", "mutant": "red: actual allow, expected ask", "restored": "green",
                      "fault": "HTTP failure auto-allows instead of retaining manual ask", "run": str(run.relative_to(root))}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
