#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path('/home/Porgy/.openclaw/workspace-mba_orchestrator/gamehub/question-bank/organizational-behaviour')
OUT = Path('/srv/gamehub/assets/mba-quiz-bank.js')

FILES = [
    ROOT / 'unit1' / 'u1-leadership-fundamentals.json',
    ROOT / 'unit1' / 'u1-leadership-theories.json',
    ROOT / 'unit2' / 'u2-7s-expanded-7s.json',
    ROOT / 'unit2' / 'u2-diversity-inclusion.json',
    ROOT / 'unit2' / 'u2-stress-wellbeing.json',
]

questions = []
for path in FILES:
    if not path.exists():
        raise SystemExit(f'Missing input file: {path}')
    questions.extend(json.loads(path.read_text()))

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text('window.MBA_QUIZ_BANK = ' + json.dumps(questions, ensure_ascii=False, indent=2) + ';\n')
print(f'Wrote {OUT} with {len(questions)} questions')
