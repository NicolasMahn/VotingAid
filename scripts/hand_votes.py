"""Reads the votes by show of hands from the Bundestag's plenary protocols.

Most decisions are taken by show of hands, not by roll call, so no member's
vote is recorded; but the chair says aloud which fractions voted how, and the
protocol keeps it word for word:

    Wer stimmt für den Antrag? – Das ist Bündnis 90/Die Grünen. Wer stimmt
    dagegen? – Das sind AfD, CDU/CSU und SPD. Wer enthält sich? – Das ist die
    Fraktion Die Linke. Damit ist der Antrag abgelehnt.

Each vote becomes an item in the same shape as a roll-call vote, with one
"member" per fraction, so the rest of the pipeline treats both alike.
Procedural votes (referrals to committees, the agenda) are left out, as are
votes whose outcome cannot be read with confidence.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

PROTOCOL_PDF = "https://dserver.bundestag.de/btp/21/{number}.pdf"

# The fractions of the 21st Bundestag and how the chair calls them.
FRACTIONS = {
    "union": r"CDU/CSU|Union",
    "spd": r"SPD|Sozialdemokrat",
    "afd": r"AfD",
    "gruene": r"Grünen|Bündnis 90",
    "linke": r"Linke|Linksfraktion",
}
COALITION = {"union", "spd"}

# A vote runs from the call for yes votes to the result.
CALL = (
    r"Wer stimmt (?:für|dafür)[^?]*\?|Ich bitte (?:diejenigen|alle)[^?.–]*?(?:zustimm|erheben|Handzeichen)[^?.]*[?.]"
    r"|Ich bitte um (?:das|Ihr) Handzeichen[^?.]*[?.]"
)
# The body may not hold another call: a vote without a result sentence must
# not run on into the next vote and take its result.
VOTE = re.compile(
    rf"(?P<call>{CALL})"
    rf"(?P<body>(?:(?!{CALL}).)*?)"
    r"(?P<result>(?:ist|sind|wurde|wird)\b[^.–]{0,200}?\b(?P<outcome>angenommen|abgelehnt|beschlossen|zurückgewiesen)[^.]*\.)",
    re.S,
)
NO = re.compile(r"Wer stimmt dagegen\?|Wer stimmt gegen\b[^?]*\?|Gegenprobe|Gegenstimmen\?|Neinstimmen\?|Wer ist dagegen\?")
ABSTAIN = re.compile(r"Wer enthält sich\??|Enthaltungen\?|Stimmenthaltungen\?|(?:Wer möchte|Möchte) sich (?:jemand )?enthalten\?")
ACCEPTED = {"angenommen", "beschlossen"}

# How the chair says that nobody voted that way.
NOBODY = re.compile(
    r"nicht der Fall|niemand|[Kk]eine[n]?\b|nicht erkennen|[Ss]ehe ich nicht|sehe ich keine|gibt es (auch )?nicht|Fehlanzeige"
)

# Votes on procedure say nothing about positions.
PROCEDURAL = re.compile(
    r"Überweisung|Federführung|Aufsetzung|Absetzung|Tagesordnung|Sammelübersicht|Fristverlängerung|"
    r"Sitzungsunterbrechung|Geschäftsordnung|Einspruch|Wahlvorschl|Wahl (?:von|eines|einer|der|des)\b",
    re.I,
)


def text(element: ET.Element) -> str:
    return re.sub(r"\s+", " ", "".join(element.itertext())).strip()


def fractions_in(answer: str, taken: set[str]) -> set[str] | None:
    """The fractions an answer names; None when it cannot be read."""
    answer = answer.strip(" –-")
    if not answer:
        return set()
    named = {party for party, pattern in FRACTIONS.items() if re.search(pattern, answer)}
    if re.search(r"bis auf|außer", answer):
        return set(FRACTIONS) - named
    if re.search(r"gesamte Haus|ganze Haus|alle Fraktionen|einstimmig|^(Wiederum |Das sind )?[Aa]lle\b", answer):
        return set(FRACTIONS)
    if not named and NOBODY.search(answer):
        return set()
    if re.search(r"Koalition", answer):
        named |= COALITION
    if re.search(r"Opposition", answer):
        named |= set(FRACTIONS) - COALITION
    if re.search(r"übrigen|Rest des Hauses|alle[rn]? anderen", answer):
        named |= set(FRACTIONS) - taken
    return named or None


def from_result(result: str, accepted: bool) -> dict[str, str] | None:
    """How each fraction voted, when the chair names them only in the result:
    "mit den Stimmen von X gegen die Stimmen von Y bei Enthaltung von Z"."""
    winners, losers = ("yes", "no") if accepted else ("no", "yes")
    parts = {
        winners: re.search(r"mit den Stimmen (.*?)(?=gegen|bei|$)", result),
        losers: re.search(r"(?:gegen die Stimmen|bei Ablehnung) (.*?)(?=mit den|bei|$)", result),
        "abstain": re.search(r"bei Enthaltung (.*?)(?=mit den|gegen|bei|$)", result),
    }
    if agree := re.search(r"bei Zustimmung (.*?)(?=mit den|gegen|bei|$)", result):
        parts["yes"] = parts.get("yes") or agree
    positions: dict[str, str] = {}
    for stance, found in parts.items():
        if found:
            for party in fractions_in(found.group(1), set(positions)) or set():
                positions.setdefault(party, stance)
    return positions if {"yes", "no"} <= set(positions.values()) else None


def read_vote(body: str, result: str, accepted: bool) -> dict[str, str] | None:
    """How each fraction voted, from the answers to the chair's questions or else from the result.
    Votes without a count of no votes are unanimous and say nothing about differences."""
    no = NO.search(body)
    if not no:
        return None
    yes_answer, rest = body[: no.start()], body[no.end() :]
    abstain = ABSTAIN.search(rest)
    no_answer, abstain_answer = (rest[: abstain.start()], rest[abstain.end() :]) if abstain else (rest, "")
    if not yes_answer.strip(" –-") and not no_answer.strip(" –-"):
        return from_result(result, accepted)
    positions: dict[str, str] = {}
    for stance, answer in (("yes", yes_answer), ("no", no_answer), ("abstain", abstain_answer)):
        if stance == "abstain" and not answer.strip(" –-"):
            continue
        named = fractions_in(answer, set(positions))
        if named is None and stance == "abstain":
            # What follows is the result, not a list: nobody abstained.
            named = set()
        if named is None:
            return None
        for party in named:
            positions.setdefault(party, stance)
    return positions if {"yes", "no"} & set(positions.values()) else None


# Where the chair starts to say what is being voted on.
SUBJECT_START = re.compile(
    r"(?:Wir kommen|Abstimmung über|[Dd]er \w*[Aa]usschuss empfiehlt|Entschließungsantrag|Änderungsantrag|Ich lasse)"
)


def subject_of(context: str) -> str:
    """What the chair said about the vote: from where the vote is introduced,
    and after any earlier vote that had no result sentence."""
    earlier = list(re.finditer(rf"{CALL}|{ABSTAIN.pattern}|{NO.pattern}", context))
    if earlier:
        after = context[earlier[-1].end() :]
        # Skip the answer to that question, up to the end of its sentence.
        context = after[after.find(".") + 1 :] if "." in after else ""
    starts = [match.start() for match in SUBJECT_START.finditer(context)]
    return (context[starts[0] :] if starts else context[-400:]).strip()


def law_name(agenda: str) -> str | None:
    """The name of the law an agenda item debates, from "Entwurfs eines Gesetzes zur …"."""
    found = re.search(r"Entwurfs? eines (.+?)(?=\s*(?:Drucksache|Beschlussempfehlung|Bericht)|\s*\(|$)", agenda)
    # "eines Faire-Mieten-Gesetzes" names the "Faire-Mieten-Gesetz".
    return re.sub(r"^(\S*[Gg]esetz)es\b", r"\1", found.group(1)) if found else None


def title_of(subject: str, call: str, agenda: dict[str, str]) -> str:
    quoted = re.findall(r"„([^“]{8,200})“", subject)
    if motion := re.search(r"(Entschließungsantrag|Änderungsantrag) der Fraktion (?:der )?([\w/ 90]+?)(?= auf| zu|\.|,|$)", subject):
        law = law_name(agenda["formula"])
        return f"{motion.group(1)} ({motion.group(2).strip()}) zu: {law or agenda['title'] or agenda['formula']}"[:200]
    if "Gesetzentwurf" in call + subject[-200:] and not quoted:
        law = law_name(subject) or law_name(agenda["formula"])
        return (law or agenda["title"] or agenda["formula"])[:200]
    title = quoted[-1] if quoted else agenda["title"] or law_name(agenda["formula"]) or agenda["formula"]
    if re.search(r"Ablehnung|abzulehnen", subject) and "Beschlussempfehlung" in subject:
        title = f"Ablehnung: {title}"
    return title[:200]


def rejected_motion(subject: str, call: str) -> dict:
    """For a vote on a committee's recommendation to reject a motion, the motion's
    title: judging the motion itself spares Jev a double negative."""
    if "Beschlussempfehlung" not in call or not re.search(r"Ablehnung|abzulehnen", subject):
        return {}
    quoted = re.findall(r"„([^“]{8,200})“", subject)
    return {"rejects": quoted[-1]} if quoted else {}


def agenda_of(item: ET.Element) -> dict[str, str]:
    """The agenda item's title, and the formula that introduces it ("Zweite und dritte Beratung des …")."""
    def joined(style: str) -> str:
        found = " ".join(text(p) for p in item.findall("p") if p.get("klasse") == style)
        return re.sub(r"^[a-z]\)\s*[–-]?\s*", "", found)[:400]

    return {"title": joined("T_fett"), "formula": joined("T_NaS")}


def votes_in(path: Path) -> list[dict]:
    root = ET.parse(path).getroot()
    sitting = int(root.get("sitzung-nr"))
    date = datetime.strptime(root.get("sitzung-datum"), "%d.%m.%Y").date().isoformat()
    items = []
    for item in root.iter("tagesordnungspunkt"):
        agenda = agenda_of(item)
        # What was said since the last vote tells what the next one is about.
        context = ""
        for paragraph in item.iter("p"):
            said = text(paragraph)
            start = 0
            for vote in VOTE.finditer(said):
                subject = subject_of((context + " " + said[start : vote.start()]).strip()[-1500:])
                start = vote.end()
                context = ""
                accepted = vote.group("outcome") in ACCEPTED and "nicht angenommen" not in vote.group("result")
                positions = read_vote(vote.group("body"), vote.group("result"), accepted)
                # A law's second reading is followed by the final vote on the same decision.
                second_reading = "zweiter Beratung" in vote.group("result")
                if not positions or second_reading or PROCEDURAL.search(subject[-400:] + vote.group("call")):
                    continue
                items.append(
                    {
                        "id": f"hand-{sitting}-{len(items)}",
                        "title": title_of(subject, vote.group("call"), agenda),
                        "date": date,
                        "period": "2025–2029",
                        "accepted": accepted,
                        # The outcome only: the result sentence often says which fractions won,
                        # and Jev must not see how the parties voted.
                        "description": f"{agenda['formula']} {agenda['title']}. {subject} {vote.group('call')} Ergebnis: {vote.group('outcome') if accepted else 'abgelehnt'}.",
                        "url": PROTOCOL_PDF.format(number=f"21{sitting:03d}"),
                        "show_of_hands": True,
                        **rejected_motion(subject, vote.group("call")),
                        # One "member" per fraction, so the per-fraction counts read as united.
                        "results": {party: {stance: 1} for party, stance in positions.items()},
                    }
                )
            context = (context + " " + said[start:]).strip()[-1200:]
    return items


def show_of_hands(protocols: list[Path]) -> list[dict]:
    return [vote for path in protocols for vote in votes_in(path)]
