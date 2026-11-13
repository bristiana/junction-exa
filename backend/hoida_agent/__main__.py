"""Run Hoida's browser hand locally."""
import argparse
import json
from . import run_browser_agent
from .hooks import ConsoleHooks


def main():
    parser = argparse.ArgumentParser(description='Run the Hoida browser agent')
    parser.add_argument('--goal', required=True)
    parser.add_argument('--url', required=True)
    parser.add_argument('--headful', action='store_true')
    parser.add_argument('--profile')
    args = parser.parse_args()
    profile = {}
    if args.profile:
        with open(args.profile) as file:
            profile = json.load(file)
        if not isinstance(profile, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in profile.items()):
            parser.error('Profile must be an object with string keys and values')
    result = run_browser_agent(args.goal, args.url, profile, ConsoleHooks(), headless=not args.headful)
    print(f'{result.status}: {result.result} ({result.final_url})')
    return 0 if result.status == 'done' else 1


if __name__ == '__main__':
    raise SystemExit(main())
