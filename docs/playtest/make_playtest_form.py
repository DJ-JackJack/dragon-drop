"""Makes the fillable playtest form for Dragon Drop 0.1.13 (US Letter, AcroForm fields).

Run: python make_playtest_form.py "Dragon Drop 0.1.13 Playtest.pdf"   (needs reportlab and PyMuPDF: pip install reportlab pymupdf)
Edit FEATURES below for a new version. Only WinAnsi characters in the text (no arrows or stars: Helvetica can't draw them).
"""
import sys
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase.pdfmetrics import stringWidth

OUT = sys.argv[1]
W, H = letter
M = 46
TW = W - 2 * M
INK = HexColor("#1c2632")
MUTED = HexColor("#56606c")
ACCENT = HexColor("#8a5d0c")
LINE = HexColor("#c3cad3")
FIELD = HexColor("#f3f5f8")
BAND = HexColor("#f4ead6")

body = ParagraphStyle("body", fontName="Helvetica", fontSize=10, leading=13.5, textColor=INK, spaceAfter=4)
small = ParagraphStyle("small", parent=body, fontSize=9.5, leading=12.5, textColor=MUTED, spaceAfter=2)
prompt = ParagraphStyle("prompt", parent=body, fontName="Helvetica-Oblique", fontSize=9.5, leading=12, textColor=MUTED, spaceAfter=3)


class Form:
    def __init__(self, path):
        self.c = canvas.Canvas(path, pagesize=letter)
        self.c.setTitle("Dragon Drop 0.1.13 Playtest")
        self.c.setAuthor("Dragon Drop")
        self.c.setSubject("Playtest form: fill it in, save it and send it back")
        self.page = 0
        self.fields = 0
        self.new_page()

    def new_page(self):
        if self.page:
            self.c.showPage()
        self.page += 1
        self.y = H - M
        self.c.setFont("Helvetica", 8.5)
        self.c.setFillColor(MUTED)
        self.c.drawString(M, M - 22, "Dragon Drop 0.1.13 playtest")
        self.c.drawRightString(W - M, M - 22, f"Page {self.page}")

    def need(self, h):
        if self.y - h < M:
            self.new_page()

    def gap(self, h):
        self.y -= h

    def para(self, html, style=body, indent=0, keep=0):
        p = Paragraph(html, style)
        _, h = p.wrap(TW - indent, 2000)
        self.need(h + keep)
        p.drawOn(self.c, M + indent, self.y - h)
        self.y -= h + style.spaceAfter

    def para_height(self, html, style=body, indent=0):
        p = Paragraph(html, style)
        _, h = p.wrap(TW - indent, 2000)
        return h + style.spaceAfter

    def heading(self, text, size=14, keep=60):
        self.need(size + 10 + keep)
        self.c.setFillColor(ACCENT)
        self.c.setFont("Helvetica-Bold", size)
        self.c.drawString(M, self.y - size, text)
        self.y -= size + 4
        self.c.setStrokeColor(ACCENT)
        self.c.setLineWidth(1.2)
        self.c.line(M, self.y, M + TW, self.y)
        self.y -= 10

    def label(self, text, x, y, size=9.5, bold=True, color=INK):
        self.c.setFillColor(color)
        self.c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        self.c.drawString(x, y, text)

    def text(self, name, tip, x, y_top, w, h, multiline=False, value=""):
        self.c.acroForm.textfield(
            name=name, tooltip=tip, x=x, y=y_top - h, width=w, height=h, value=value,
            fontName="Helvetica", fontSize=10, borderStyle="solid", borderWidth=0.8,
            borderColor=LINE, fillColor=FIELD, textColor=INK, forceBorder=True,
            fieldFlags="multiline" if multiline else "",
            maxlen=0,  # (no limit: the library's default of 100 characters cut answers short in the 0.1.13 playtest)
        )
        self.fields += 1

    def field(self, name, lab, h=20, multiline=False, x=None, w=None, value="", advance=True):
        """A label above a box."""
        x = M if x is None else x
        w = TW if w is None else w
        self.need(14 + h + 8)
        self.label(lab, x, self.y - 10)
        self.text(name, lab, x, self.y - 14, w, h, multiline, value)
        if advance:
            self.y -= 14 + h + 10

    def radios(self, name, lab, options, lab_w=120, tip=None, above=False):
        """A row: a label, then circles with their words. Options are (value, words).
        With above, the label has a line of its own and the circles go under it."""
        self.need(38 if above else 20)
        if above:
            self.label(lab, M, self.y - 10, size=9.5)
            self.y -= 16
            lab_w = 0
        else:
            self.label(lab, M, self.y - 11, size=9.5)
        base = self.y - 12
        x = M + lab_w
        for value, words in options:
            ww = stringWidth(words, "Helvetica", 9.5)
            if x + 14 + ww > M + TW:
                self.y -= 18
                base = self.y - 12
                x = M + lab_w
            self.c.acroForm.radio(
                name=name, value=value, selected=False, x=x, y=base - 1.5, size=11,
                buttonStyle="circle", borderStyle="solid", borderWidth=1,
                borderColor=MUTED, fillColor=white, textColor=INK, forceBorder=True,
                tooltip=f"{tip or lab} {words}",
            )
            self.label(words, x + 15, base + 1, bold=False)
            x += 15 + ww + 18
        self.fields += 1
        self.y -= 20

    def rule(self):
        self.c.setStrokeColor(LINE)
        self.c.setLineWidth(0.6)
        self.c.line(M, self.y, M + TW, self.y)
        self.y -= 12

    def feature(self, n, fid, title, keys, try_text, ask):
        h = 22 + self.para_height("<b>Try:</b> " + try_text, indent=0) + 20 + 20 + 20 + self.para_height(ask, prompt) + 48 + 14
        self.need(h)
        self.c.setFillColor(INK)
        self.c.setFont("Helvetica-Bold", 12)
        t = f"{n}. {title}"
        self.c.drawString(M, self.y - 12, t)
        if keys:
            self.c.setFont("Helvetica", 9.5)
            self.c.setFillColor(MUTED)
            self.c.drawString(M + stringWidth(t, "Helvetica-Bold", 12) + 10, self.y - 12, keys)
        self.y -= 20
        self.para("<b>Try:</b> " + try_text)
        self.radios(f"{fid}_found", "Easy to find?", [("easy", "Yes"), ("took_a_while", "Took a while"), ("not_found", "Couldn't find it")], tip=f"{title}: easy to find?")
        self.radios(f"{fid}_result", "How did it go?", [("worked", "It worked"), ("problem", "I had a problem"), ("not_tried", "Didn't try")], tip=f"{title}: how did it go?")
        self.radios(f"{fid}_useful", "Useful for your game?", [("very", "Very"), ("a_bit", "A bit"), ("not_really", "Not really")], tip=f"{title}: useful for your game?")
        self.para(ask, prompt)
        self.text(f"{fid}_comments", f"{title}: comments", M, self.y, TW, 44, multiline=True)
        self.y -= 44 + 12
        self.rule()

    def save(self):
        self.c.save()


f = Form(OUT)
c = f.c

# Title
c.setFillColor(BAND)
c.rect(0, H - 112, W, 112, stroke=0, fill=1)
c.setFillColor(INK)
c.setFont("Helvetica-Bold", 24)
c.drawString(M, H - 58, "Dragon Drop 0.1.13")
c.setFont("Helvetica", 14)
c.setFillColor(ACCENT)
c.drawString(M, H - 80, "Playtest form")
c.setFont("Helvetica", 9.5)
c.setFillColor(MUTED)
c.drawString(M, H - 97, "Thank you for testing. About 20 to 40 minutes; skip anything you don't get to.")
f.y = H - 130

f.heading("How to fill this in", keep=120)
f.para("<b>1.</b> Open this file in a PDF reader that fills in forms: <b>Microsoft Edge</b> (already on every Windows PC), Adobe Acrobat Reader, or most web browsers.")
f.para("<b>2.</b> Click in a box to type. Click a circle to choose. You don't have to try everything: pick <b>Didn't try</b> for anything you skip.")
f.para("<b>3.</b> When something goes wrong, say <b>what you did</b>, <b>what you expected</b> and <b>what you saw</b>. A screenshot helps a lot: send it along with this form.")
f.para("<b>4.</b> Save the file (<b>Ctrl+S</b>) and send the saved copy back to whoever sent it to you.")
f.para("Dragon Drop saves your work as you go. Before trying something big on a map you care about, make a copy first: <b>Map panel &gt; Other maps &gt; Duplicate this map</b>.", small)
f.gap(6)

f.heading("About you", keep=200)
half = (TW - 16) / 2
top = f.y
f.field("tester_name", "Your name", x=M, w=half, advance=False)
f.field("test_date", "Date", x=M + half + 16, w=half / 2 - 8, advance=False)
f.field("version", "Version tested", x=M + half + 16 + half / 2 + 8, w=half / 2 - 8, value="0.1.13", advance=False)
f.y = top - 44
f.radios("windows", "Windows", [("win11", "Windows 11"), ("win10", "Windows 10"), ("unsure", "Not sure")])
f.radios("screens", "Screens", [("one", "One screen"), ("two_or_tv", "Two screens, or a TV")])
f.radios("install", "This version", [("updated", "Updated from an older Dragon Drop"), ("fresh", "First install")])
f.radios("assistant", "AI assistant", [("none", "None"), ("claude_code", "Claude Code"), ("other", "Another one")])
f.field("assistant_other", "If another AI assistant, which one?")
f.field("pc", "Your PC: its model or roughly how old it is, if you know")
f.field("time_spent", "About how long did you play with it?")

f.heading("Installing and updating", keep=160)
f.radios("update_kept", "After updating, my maps, settings and asset folder were all still there", [("yes", "Yes"), ("no", "No"), ("fresh", "First install")], above=True)
f.para("The phone page is gone in this version: Dragon Drop now answers only your own PC. You can still talk to Claude from your phone with Claude Code's Remote Control.", small)
f.field("install_comments", "Anything that went wrong installing, updating or starting it?", h=44, multiline=True)

f.heading("What's new in this update", keep=170)
f.para("Fifteen new things. Each says exactly where to start. For each: was it easy to find, did it work, would you use it, and a box for anything you noticed. "
       "The <b>tool rail</b> is the column of tools down the left; the <b>Map panel</b> is on the right (with tabs Map, Objects, History and Assets); the <b>bottom bar</b> runs under the map.", small)
f.gap(4)

FEATURES = [
    ("ruler", "Ruler and travel times", "keys: K on world maps and settlements, M on battlemaps",
     "on a world map press <b>K</b>, click points along a route and double-click to finish. The bar along the top shows the distance, the time on foot, riding, by wagon and by ship, and what the route crosses (roads, rough ground, water, rivers, the climb). "
     "Change a pace there and open the ruler again: it is remembered. On a battlemap (<b>M</b>) it measures feet and squares.",
     "Do the travel times feel right for your game? Anything wrong?"),
    ("print", "Printing a battlemap at table scale", "",
     "on a battlemap click <b>Export</b> in the bottom bar, then <b>Print at table scale</b>: it says how many pages, on Letter or A4. Print one page at <b>Actual size</b> (not “Fit to page”) and measure a square: it should be one inch. Try <b>Save ink</b> too.",
     "Was a square one inch? Did the pages join up when you laid them side by side?"),
    ("scatter", "Scatter brush", "key: P on battlemaps (the Object tool)",
     "press <b>P</b>; the Map panel shows the <b>Assets</b> tab: click a tree or a rock there. In the bar along the top click <b>Scatter</b>, then drag across the map. One Undo takes the whole stroke back. <b>Only on floor</b> keeps them off the empty void.",
     "Did it look natural? Did anything overlap or land somewhere it shouldn't?"),
    ("gm_only", "GM-only secrets", "",
     "select a place (world map), an object or a light (battlemap) or a building (settlement) with the Select tool (<b>V</b>), and tick <b>GM only</b> in its panel on the right (on a battlemap, the Object tool's bar also has <b>GM only</b> for new objects): it shows faintly to you, with a small GM tag on battlemaps. Then <b>Export</b> (bottom bar): world maps and settlements have a <b>For players: leave out what is GM only</b> tick box (on by default); battlemaps leave them out unless you tick <b>My own copy</b>. The player screen never shows them.",
     "Did any secret show up anywhere players would see it? This one matters most."),
    ("prefabs", "Prefabs", "key: C on battlemaps",
     "press <b>C</b>. In the bar along the top choose <b>Save</b>, drag over a room and give it a name. Then choose <b>Place</b>, pick it by its picture and click the map; <b>Q</b> and <b>E</b> turn it, <b>X</b> mirrors it. Try placing it on another battlemap.",
     "Did it come out the way you saved it?"),
    ("generate", "Generate a dungeon, cave or village", "",
     "in the Map panel's <b>Map</b> tab, the <b>Generate</b> section: on a battlemap make a dungeon (small, medium or large), then a cave; on a settlement, a hamlet, a village or a large village. It asks before replacing what is there. Typing the same seed makes the same map again.",
     "Would you run these at your table? What's missing?"),
    ("player_screen", "Player screen and fog", "best on a TV or second screen",
     "on a battlemap click <b>Player screen</b> in the bottom bar (next to Export). On a second screen it fills that screen: <b>Esc</b> makes it an ordinary window again, <b>F11</b> fills the screen, and <b>Close it</b> in the Map panel's Player screen section closes it. "
     "Turn on <b>Fog</b> and the screen goes black; then the <b>Reveal</b> tool (the eye in the tool rail) shows a room with a click.",
     "Did the players' screen ever show something it shouldn't? Could you close it again? Was it easy to run during play?"),
    ("realms", "Realms", "key: B on world maps",
     "press <b>B</b>. At the left of the bar along the top, <b>Choose a realm</b> opens the list: type a name and click <b>Add</b>, then drag on the map to paint it. <b>Land only</b> stops it at the coast; paint a second realm with <b>Round neighbours</b> next to the first.",
     "Did the borders and names look right?"),
    ("tints", "Object shadows and tints", "",
     "on a battlemap select an object with <b>V</b>; its panel on the right has <b>Shadow</b>, <b>Tint</b> and <b>Strength</b>. Grey “colour it yourself” pictures from asset packs take a tint best. The Object tool's bar (<b>P</b>) has <b>Shadow</b> for new objects.",
     "Did tinted objects look good, and the same in an exported picture?"),
    ("note_links", "Links to your own notes", "",
     "on a world map press <b>V</b> and click a place's marker. In its panel on the right, under Notes, <b>Your notes (a link)</b>: paste a web address and press Enter, or <b>Choose a file…</b>; then <b>Open</b>. For Obsidian, right-click a note there, <b>Copy Obsidian URL</b>, and paste that. Realms have a <b>Link</b> button in the realm list.",
     "Which notes app do you use (Obsidian, OneNote, Word, a wiki...), and did its links open?"),
    ("ink", "Ink style", "",
     "on a world map, the Map panel's <b>Style</b> section: click <b>Ink</b>. Try it on your biggest map, then export a picture (<b>Export</b> in the bottom bar).",
     "Would you hand this map to your players? Did it feel slow?"),
    ("object_layers", "Object layers", "key: P on battlemaps (the Object tool)",
     "press <b>P</b> and click <b>Layers…</b> in the bar along the top: type a name for a new layer and click <b>Add</b>. Pick an object in the Assets tab and click the map: it goes into that layer (<b>Into layer</b> in the same bar chooses). In the Layers list each layer has an eye (hide), a padlock (lock), up and down arrows (order) and an X (remove; its objects stay).",
     "Was it clear which layer new objects went into?"),
    ("city_land", "A settlement's land", "",
     "click <b>+ New map</b>, choose Settlement and pick <b>The land</b> (Rolling hills, Hilltop, Valley...). On a settlement, the Map panel's <b>Land and climate</b> section can start the land again, or <b>Shape the land by hand</b> with the Land tool (<b>L</b>).",
     "Did the hills and valleys look like a place a town would stand?"),
    ("packs", "Your asset packs everywhere", "",
     "choose your asset folder in <b>Settings &gt; Maps and assets</b> (without packs of your own, ten free <b>Starter Pack</b> floors are there). Then on a battlemap: floors from your packs in the floor picker, walls in the Wall tool's <b>Walls:</b>, doors and windows, paths, roofs and light shapes. "
     "Right-click a picture to star it; <b>Starred</b> and <b>Recent</b> are in every picker. A battlemap made with <b>Battlemap here</b> from a world map or settlement uses your packs.",
     "Did your packs show up, were their pictures sorted sensibly, and did Dragon Drop pick fitting ones?"),
    ("dry_rivers", "Rivers in dry country", "",
     "make a new world map with a dry region: dry land has few rivers. The Map panel's <b>Climate</b> section has <b>Dry land has few rivers</b> and <b>No rivers from the rain</b> (which leaves lakes and rivers you drew).",
     "Did the rivers end up where you'd expect them?"),
]
for i, (fid, title, keys, tr, ask) in enumerate(FEATURES, 1):
    f.feature(i, fid, title, keys, tr, ask)

f.heading("Overall", keep=200)
f.radios("lost_work", "Did it crash, freeze or lose any of your work?", [("no", "No"), ("yes", "Yes")], above=True)
f.field("lost_work_what", "If yes, what happened? What were you doing just before?", h=44, multiline=True)
f.field("slow", "Did anything feel slow? Which map, and doing what?", h=36, multiline=True)
f.field("ai_assistant", "If you used an AI assistant with the map tools: how did it go? Did it ask you before replacing something?", h=44, multiline=True)
f.field("liked", "What did you like most?", h=44, multiline=True)
f.field("frustrated", "What frustrated or confused you?", h=44, multiline=True)
f.field("next", "What would you want in the next update?", h=44, multiline=True)
f.radios("ready", "How ready does it feel to sell to other GMs?", [("not_yet", "Not yet"), ("nearly", "Nearly"), ("ready", "Ready")], above=True)
f.field("anything_else", "Anything else?", h=44, multiline=True)
f.gap(4)
f.para("Thank you! Save the file (<b>Ctrl+S</b>) and send it back, with any screenshots.", body)

f.save()

# reportlab's round radio buttons draw their "off" look with a font glyph that some readers show
# as a stray symbol; redraw every radio button's look as plain circles.
import os
import fitz  # PyMuPDF
tmp = OUT + ".tmp"
os.replace(OUT, tmp)
doc = fitz.open(tmp)
radio_xrefs = []
for page in doc:
    for w in page.widgets():
        if w.field_type == fitz.PDF_WIDGET_TYPE_RADIOBUTTON:
            w.update()
            radio_xrefs.append(w.xref)
# Redrawing switches a button on; start every group with nothing chosen.
parents = set()
for x in radio_xrefs:
    doc.xref_set_key(x, "AS", "/Off")
    kind, ref = doc.xref_get_key(x, "Parent")
    if kind == "xref":
        parents.add(int(ref.split()[0]))
for p in parents:
    doc.xref_set_key(p, "V", "/Off")
doc.save(OUT, garbage=3, deflate=True)
doc.close()
os.remove(tmp)
print("pages", f.page, "fields", f.fields)
