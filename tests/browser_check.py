"""Browser regression entrypoint: paired imports replace the legacy manual workflow."""
import asyncio
import sys
from ops_check import run

if __name__ == '__main__':
    asyncio.run(run(sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4200', '--offline' in sys.argv))