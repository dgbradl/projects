"""Entry point: python -m nofinalstop"""

import argparse
import sys

from .ui.app import App


def main(argv=None):
    p = argparse.ArgumentParser(
        prog="nofinalstop",
        description="NO FINAL STOP — a party-based survival-horror roguelite aboard an impossible train.")
    p.add_argument("--seed", type=int, default=None, help="seed the nightmare (reproducible runs)")
    p.add_argument("--plain", action="store_true", help="plain text output (no rich styling)")
    p.add_argument("--auto", action="store_true", help="let a bot play a full run (demo/test)")
    p.add_argument("--auto-verbose", action="store_true", help="show the bot's decisions")
    p.add_argument("--party", type=int, default=4, choices=(3, 4, 5), help="party size for quick start")
    p.add_argument("--secret-mode", choices=("all", "some", "none"), default="all",
                   help="how much the player knows of the characters' secrets")
    p.add_argument("--save-dir", default=None, help="directory for save files (default ./saves)")
    p.add_argument("--web", action="store_true",
                   help="serve the graphical front-end in your browser instead of the terminal")
    p.add_argument("--port", type=int, default=8337, help="port for --web (default 8337)")
    p.add_argument("--no-browser", action="store_true", help="with --web: don't auto-open a browser")
    args = p.parse_args(argv)

    if args.web:
        from .web.server import serve
        serve(seed=args.seed, save_dir=args.save_dir, secret_mode=args.secret_mode,
              port=args.port, open_browser=not args.no_browser)
        return 0

    app = App(seed=args.seed, plain=args.plain, auto=args.auto or args.auto_verbose,
              party_size=args.party, secret_mode=args.secret_mode, save_dir=args.save_dir,
              verbose_auto=args.auto_verbose)
    game = app.run()
    return 0 if game is None or game.ending else 1


if __name__ == "__main__":
    sys.exit(main())
