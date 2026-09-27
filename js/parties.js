// The parties and their programs for the Bundestagswahl 2025. The order is the
// order of the result list when scores tie. Colors live in css/theme.css.
// Names are the official ones; adoption dates are from the programs themselves
// where they say so, and from the parties' announcements otherwise.
export const PARTIES = [
  {
    id: 'afd',
    short: 'AfD',
    name: 'Alternative für Deutschland',
    program: { title: 'Zeit für Deutschland', adopted: 'Beschlossen 2025-01-11/12, Bundesparteitag in Riesa', pages: 177, megabytes: 0.9 },
  },
  {
    id: 'bsw',
    short: 'BSW',
    name: 'Bündnis Sahra Wagenknecht – Vernunft und Gerechtigkeit',
    // Approved 2025-12-06; the short name stays BSW.
    renamed: { from: '2026-10-01', to: 'Bündnis Soziale Gerechtigkeit und Wirtschaftliche Vernunft' },
    program: { title: 'Unser Land verdient mehr!', adopted: 'Beschlossen 2025-01-12, Bundesparteitag in Bonn', pages: 45, megabytes: 1.2 },
  },
  {
    id: 'fdp',
    short: 'FDP',
    name: 'Freie Demokratische Partei',
    program: { title: 'Alles lässt sich ändern', adopted: 'Beschlossen 2024-12-17 vom Bundesvorstand', pages: 52, megabytes: 0.8 },
  },
  {
    id: 'gruene',
    short: 'Grüne',
    name: 'Bündnis 90/Die Grünen',
    program: { title: 'Zusammen wachsen', adopted: 'Beschlossen 2025-01-26, Bundesdelegiertenkonferenz in Berlin', pages: 160, megabytes: 1.3 },
  },
  {
    id: 'linke',
    short: 'Linke',
    name: 'Die Linke',
    program: { title: 'Alle wollen regieren. Wir wollen verändern.', adopted: 'Beschlossen 2025-01-18, Parteitag in Berlin', pages: 60, megabytes: 0.8 },
  },
  {
    id: 'spd',
    short: 'SPD',
    name: 'Sozialdemokratische Partei Deutschlands',
    program: { title: 'Mehr für Dich. Besser für Deutschland.', adopted: 'Beschlossen 2025-01-11, Bundesparteitag in Berlin', pages: 68, megabytes: 0.8 },
  },
  {
    id: 'union',
    short: 'CDU/CSU',
    name: 'Christlich Demokratische Union Deutschlands und Christlich-Soziale Union in Bayern',
    program: { title: 'Politikwechsel für Deutschland', adopted: 'Beschlossen 2024-12-17 von den Vorständen von CDU und CSU in Berlin', pages: 82, megabytes: 3.3 },
  },
];

export const programUrl = (party, page) => `programme/${party}.pdf${page ? `#page=${page}` : ''}`;
