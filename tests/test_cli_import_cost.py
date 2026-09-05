# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Opus).

"""Guards on what `import cli` is allowed to drag in.

Every CLI invocation pays for the module's top-level imports, and the app
invokes the CLI constantly -- the Events tab writes its sidecar through it on
each edit. On 2026-09-05 that cost was measured at ~1.5s per call for a few
milliseconds of real work, and the user felt it directly: "the lag in being
able to edit after entering an event persists".

Two libraries accounted for nearly all of it:

    matplotlib.pyplot   407ms   via visualizations.motion, imported eagerly
                                for a command that never draws anything
    scipy.ndimage       460ms   via videoflow's eager __init__, reached by
                                importing videoflow.sidecar for a PATH helper

Both are lazy now. Nothing else stops someone reintroducing a convenient
top-level import and silently handing that second back -- the suite would
simply get slower, which is not a signal anyone reads. Hence these tests.

They run in a SUBPROCESS on purpose: pytest has its own imports, so
inspecting this process's sys.modules would prove nothing.
"""

import json
import os
import subprocess
import sys
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Import roots that must not be loaded by a bare `import cli`, and why.
FORBIDDEN = {
    "matplotlib": "plotting: only cmd_visualize needs it",
    "scipy": "signal processing: only the audio pipeline needs it",
    "librosa": "audio analysis: only the audio pipeline needs it",
}


def _modules_after(statement):
    """Run `statement` in a fresh interpreter; return its loaded import roots."""
    code = (
        f"{statement}\n"
        "import sys, json\n"
        "print(json.dumps(sorted({m.split('.')[0] for m in sys.modules})))\n"
    )
    proc = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True, text=True, cwd=REPO,
    )
    assert proc.returncode == 0, f"subprocess failed:\n{proc.stderr}"
    return set(json.loads(proc.stdout))


class TestCliImportCost(unittest.TestCase):

    def test_import_cli_does_not_load_heavy_libraries(self):
        loaded = _modules_after("import cli")
        offenders = sorted(loaded & set(FORBIDDEN))
        self.assertEqual(
            offenders, [],
            "`import cli` pulled in "
            + ", ".join(f"{name} ({FORBIDDEN[name]})" for name in offenders)
            + ". Move the import inside the command that needs it -- every CLI"
            " call pays for it, and the Events tab makes one per edit.",
        )

    def test_importing_a_path_helper_stays_cheap(self):
        """videoflow.sidecar is reached for pure path work.

        forge_dir/sidecar_path_for compute paths. Importing them used to run
        videoflow's eager __init__, which imported the audio pipeline and so
        scipy. videoflow re-exports lazily now; this fails if that regresses.
        """
        loaded = _modules_after("from videoflow.sidecar import forge_dir")
        offenders = sorted(loaded & set(FORBIDDEN))
        self.assertEqual(
            offenders, [],
            f"importing a path helper pulled in {offenders} -- check whether "
            "videoflow's __init__ went back to eager re-exports.",
        )

    def test_the_guard_itself_works(self):
        """A control: the check must be able to SEE a heavy import.

        Without this, a typo in the module-name matching would make both
        tests above pass vacuously forever.
        """
        loaded = _modules_after("import matplotlib.pyplot")
        self.assertIn("matplotlib", loaded)


if __name__ == "__main__":
    unittest.main()
