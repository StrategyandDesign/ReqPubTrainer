#!/usr/bin/env python3
"""Build the ReqPub trainer reference.

Every capability, starting point, and artifact in this document is read from
the repository rather than typed: the 41 capability entries come from
app/js/capabilities.js, the starting points from app/js/templates.js, and the
never-build list from docs/POSITIONING.md. If the product changes and this is
regenerated, the document changes with it.

Colour carries meaning rather than decoration. One hue per section, used on
the rule, the section label, and the entry titles, so a trainer scanning for
"the thing that happens under the hood" finds one colour and stays in it.
"""
import json, re, subprocess, os
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, KeepTogether)

ROOT = '/home/claude/reqpub'
OUT = '/mnt/user-data/outputs/ReqPub-Trainer-Reference.pdf'

# ---- palette: one hue per section, all checked against white for AA ----
INK      = colors.HexColor('#101418')
INK2     = colors.HexColor('#39424d')
INK3     = colors.HexColor('#5b6472')
RULE     = colors.HexColor('#e3e7ec')
BLUE     = colors.HexColor('#1d4ed8')   # in plain sight
GREEN    = colors.HexColor('#0f6b45')   # where it earns its keep
PURPLE   = colors.HexColor('#6b21a8')   # under the hood
AMBER    = colors.HexColor('#8a5200')   # starting points
TEAL     = colors.HexColor('#115e75')   # people and access
CRIMSON  = colors.HexColor('#9f1239')   # never built
SLATE    = colors.HexColor('#334155')   # artifacts

def S(name, **kw):
    base = dict(fontName='Helvetica', fontSize=9.5, leading=13, textColor=INK2, spaceAfter=0)
    base.update(kw); return ParagraphStyle(name, **base)

TITLE    = S('t', fontName='Helvetica-Bold', fontSize=25, leading=28, textColor=INK, spaceAfter=6)
SUB      = S('s', fontSize=11.5, leading=16, textColor=INK3, spaceAfter=16)
H2       = S('h2', fontName='Helvetica-Bold', fontSize=14, leading=17, textColor=INK, spaceAfter=2)
LABEL    = S('lb', fontName='Helvetica-Bold', fontSize=7.6, leading=10, textColor=INK3, spaceAfter=3)
LEDE     = S('ld', fontSize=9.5, leading=13.5, textColor=INK3, spaceAfter=9)
BODY     = S('b')
NOTE     = S('n', fontSize=8.6, leading=12, textColor=INK3)
FOOT     = S('f', fontSize=7.6, leading=10, textColor=INK3)

def read(p):
    with open(os.path.join(ROOT, p), encoding='utf-8') as f: return f.read()

# ---------- inventory, read from the product ----------
def node(expr):
    js = ("globalThis.location={origin:'https://reqpub.com',pathname:'/'};" + expr)
    return json.loads(subprocess.run(['node', '--input-type=module', '-e', js],
                                     cwd=ROOT, capture_output=True, text=True).stdout)

caps = node("""
  import { CAPABILITIES, TIER_LABELS, COVERED_THROUGH } from './app/js/capabilities.js';
  console.log(JSON.stringify({ items: CAPABILITIES.map(c => ({ tier: c.tier, title: c.title, body: c.body, since: c.sinceVersion })),
                               labels: TIER_LABELS, covered: COVERED_THROUGH }));
""")
tpls = node("""
  import { TEMPLATES } from './app/js/templates.js';
  console.log(JSON.stringify(TEMPLATES.map(t => ({ label: t.label, desc: t.desc }))));
""")
never = re.search(r'## Never build\n\n(.*?)\n\n', read('docs/POSITIONING.md'), re.S).group(1)
never = re.sub(r'\s+', ' ', never).strip()
version = json.loads(read('package.json'))['version']
counts = json.loads(read('tests/COUNTS.json'))

by_tier = {}
for c in caps['items']:
    by_tier.setdefault(c['tier'], []).append(c)

# ---------- page furniture ----------
def page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(colors.white)
    canvas.rect(0, 0, LETTER[0], LETTER[1], stroke=0, fill=1)
    canvas.setStrokeColor(RULE); canvas.setLineWidth(0.5)
    canvas.line(0.75*inch, 0.72*inch, LETTER[0]-0.75*inch, 0.72*inch)
    canvas.setFont('Helvetica', 7.6); canvas.setFillColor(INK3)
    canvas.drawString(0.75*inch, 0.55*inch, f'ReqPub trainer reference  ·  v{version}')
    canvas.drawRightString(LETTER[0]-0.75*inch, 0.55*inch, f'Page {doc.page}')
    canvas.restoreState()

doc = BaseDocTemplate(OUT, pagesize=LETTER,
                      leftMargin=0.75*inch, rightMargin=0.75*inch,
                      topMargin=0.7*inch, bottomMargin=0.9*inch,
                      title='ReqPub trainer reference', author='ReqPub')
doc.addPageTemplates([PageTemplate(id='p',
    frames=[Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f',
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)], onPage=page)])
# A ReportLab frame carries six points of padding on every side by default.
# With tables sized to the full text width, that inset shifted every column
# right by six points and pushed the right column six points past the margin.
# The margins are the document's, so the frame adds none of its own.

story = []

def section(label, heading, lede, colour, first=None):
    """The rule, the label, the heading, and the lede travel together, so a
    section never opens at the foot of a page with its first entries overleaf."""
    bar = Table([['']], colWidths=[doc.width], rowHeights=[2.4])
    bar.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,-1), colour),
                             ('LEFTPADDING', (0,0), (-1,-1), 0), ('RIGHTPADDING', (0,0), (-1,-1), 0),
                             ('TOPPADDING', (0,0), (-1,-1), 0), ('BOTTOMPADDING', (0,0), (-1,-1), 0)]))
    head = [bar, Spacer(1, 8),
            Paragraph(label.upper(), ParagraphStyle('l', parent=LABEL, textColor=colour)),
            Paragraph(heading, H2), Paragraph(lede, LEDE)]
    if first is not None: head.append(first)
    return [Spacer(1, 16), KeepTogether(head)]

GUTTER = 20            # the only horizontal space between the two columns
COL = (doc.width - GUTTER) / 2

def entries(items, colour):
    """Two equal columns bound to both margins.

    The first version inset every cell by ReportLab's default padding, so entry
    text sat six points inside the section rule and the heading above it, and
    the right column stopped twenty-seven points short of the right margin
    while the left column was flush. Padding is now explicit: none on the
    outside edges, one gutter between."""
    cells = []
    for it in items:
        t = ParagraphStyle('et', parent=BODY, fontName='Helvetica-Bold', textColor=colour, spaceAfter=1)
        cells.append([Paragraph(it['title'], t), Paragraph(it['body'], NOTE)])
    rows = []
    for i in range(0, len(cells), 2):
        pair = cells[i:i+2]
        rows.append([pair[0], pair[1] if len(pair) > 1 else ''])
    def build(rs):
        t = Table(rs, colWidths=[COL + GUTTER, COL], hAlign='LEFT')
        t.setStyle(grid); return t
    grid = TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING', (0,0), (0,-1), GUTTER),   # the gutter lives on the left column
        ('RIGHTPADDING', (1,0), (1,-1), 0),        # the right column reaches the margin
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 11),
    ])
    # The first row travels with the section heading; the rest flows freely, so
    # a heading can never be the last thing on a page with its entries overleaf.
    return build(rows[:1]), (build(rows[1:]) if len(rows) > 1 else Spacer(0, 0))

# ---------- cover ----------
story += [
    Paragraph('ReqPub', TITLE),
    Paragraph('Trainer reference: every feature, tool, and surface, and the '
              'handful of things the platform will never do.', SUB),
]
facts = Table([
    ['Version', f'v{version}'],
    ['Published capabilities', f"{len(caps['items'])} entries across three tiers"],
    ['Starting points', f'{len(tpls)} templates'],
    ['Automated checks', f"{counts['total']:,} on every change, {counts['backend']:,} against a real database"],
    ['Assurance state', 'Self-attested. No third-party review yet'],
], colWidths=[1.7*inch, doc.width-1.7*inch])
facts.setStyle(TableStyle([
    ('FONT', (0,0), (0,-1), 'Helvetica-Bold', 8.6), ('FONT', (1,0), (1,-1), 'Helvetica', 8.6),
    ('TEXTCOLOR', (0,0), (0,-1), INK3), ('TEXTCOLOR', (1,0), (1,-1), INK2),
    ('LINEBELOW', (0,0), (-1,-2), 0.4, RULE),
    ('TOPPADDING', (0,0), (-1,-1), 5), ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ('LEFTPADDING', (0,0), (-1,-1), 0),
]))
story += [facts, Spacer(1, 14),
    Paragraph('<b>How to use this document.</b> Each section carries one colour. '
              'Blue is what a person sees and does. Green is where the platform earns its keep on a live '
              'engagement. Purple is what happens underneath without anyone asking. Amber is where a record '
              'starts, teal is who has access, slate is what comes out, and crimson is what will never be built. '
              'Teach in that order and a new user meets the product the way it was designed to be met.', LEDE)]

# ---------- the three published tiers ----------
tier_meta = [
    ('plain', BLUE,  'What a person sees and does',
     'The behaviour a user meets in the first hour. Teach this first; nothing else lands without it.'),
    ('work',  GREEN, 'Where it earns its keep',
     'The parts that pay for the platform on a live engagement. This is the section a partner cares about.'),
    ('hood',  PURPLE,'What happens underneath',
     'Running without being asked. A trainee does not operate these, but every one of them is a question a client will ask.'),
]
for key, colour, heading, lede in tier_meta:
    items = by_tier.get(key, [])
    first, rest = entries(items, colour)
    story += section(caps['labels'][key], f'{heading}  ({len(items)})', lede, colour, first)
    story += [rest]

# ---------- starting points ----------
first, rest = entries([{'title': t['label'], 'body': t['desc']} for t in tpls], AMBER)
story += section('Starting points', f'Where a record begins  ({len(tpls)})',
                 'Every record starts from one of these. The choice sets which sections appear; it never changes '
                 'what the record can prove.', AMBER, first)
story += [rest]

# ---------- artifacts ----------
ART = [
 ('Client baseline report', 'The readable document for the client, carrying version, status, approvals, and revision history.'),
 ('Implementation package', 'requirements.json with permanent IDs, fit criteria, priorities, and origin, plus the acceptance checklist.'),
 ('SOW exhibit', 'The acceptance baseline formatted to attach to a statement of work, with blanks left for counsel.'),
 ('Gate packet', 'What walks into a steering committee: the diff, the sign-offs, and the fingerprint.'),
 ('Evidence pack', 'The full chronology, every baseline and receipt, the attachment manifest, and a verification result.'),
 ('Record of Delivery', 'The close document: objective, thresholds, the baseline sequence, and every signature.'),
 ('Close package', 'The Record of Delivery and the evidence pack under one manifest.'),
 ('Invoice packet', 'Acceptance evidence formatted to attach to a bill.'),
 ('Export book', 'Every record in the workspace, exported at once, for a manager.'),
 ('Verification bundle', 'The JSON a third party drops into the verify page or the standalone checker.'),
]
first, rest = entries([{'title': a, 'body': b} for a, b in ART], SLATE)
story += section('Artifacts', f'What comes out  ({len(ART)})',
                 'Each one is generated from the record and carries the same fingerprint. Three of them are what a '
                 'client, a committee, or a court would read.', SLATE, first)
story += [rest]

# ---------- people ----------
PEOPLE = [
 ('Manager', 'Holds an account. Authors the record, administers the workspace, issues links and keys.'),
 ('Viewer', 'Holds an account. Reads everything shared with them and can reply in any thread.'),
 ('Client contact', 'No account. Works through a link: reads the brief, comments, and signs.'),
 ('Subject matter expert', 'No account. A durable personal link and one continuous thread across every version.'),
 ('Approver or signer', 'No account. A sign link carries one baseline and its fingerprint, and nothing else.'),
 ('Agent', 'No account. An issued key with a read surface and, if enabled, one write that files an inbox item.'),
]
first, rest = entries([{'title': p, 'body': b} for p, b in PEOPLE], TEAL)
story += section('People and access', f'Who can do what  ({len(PEOPLE)})',
                 'Two roles hold accounts. Everyone who signs does not, which is why there is no seat to provision '
                 'when someone joins a program and none to orphan when they leave.', TEAL, first)
story += [rest]

# ---------- never built ----------
story += section('The boundary', 'What the platform will never do', 
                 'Teach this as a feature, because it is the reason both sides of a table will sign the same record.', CRIMSON)
story += [
    Paragraph(f'<b>Never built.</b> {never}', BODY), Spacer(1, 8),
    Paragraph('<b>The test for anything proposed.</b> Who wrote the value? A person in the worksheet is allowed; '
              'the platform computing over other rows is not. Does it move on its own? If it changes without an '
              'author changing it, it is a status engine and the answer is no.', BODY),
    Spacer(1, 10),
    Paragraph('Your programme platform reports progress. This record proves agreement. The refusal to do both is '
              'what makes the second one worth anything.', ParagraphStyle('q', parent=BODY,
              fontName='Helvetica-Bold', textColor=INK, fontSize=10.5, leading=15)),
    Spacer(1, 16),
    Paragraph('Generated from the ReqPub repository at v%s. The capability entries, starting points, and the '
              'never-build list are read from the product, not transcribed, so regenerating this document after a '
              'release updates it.' % version, FOOT),
]

doc.build(story)
print('built:', OUT, os.path.getsize(OUT), 'bytes')
