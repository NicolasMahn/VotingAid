// The parties and their programs for the Bundestagswahl 2025. The order is the
// order of the result list when scores tie. Colors live in css/style.css.
export const PARTIES = [
  { id: 'afd', short: 'AfD', name: 'Alternative für Deutschland' },
  { id: 'bsw', short: 'BSW', name: 'Bündnis Sahra Wagenknecht' },
  { id: 'fdp', short: 'FDP', name: 'Freie Demokratische Partei' },
  { id: 'gruene', short: 'Grüne', name: 'Bündnis 90/Die Grünen' },
  { id: 'linke', short: 'Linke', name: 'Die Linke' },
  { id: 'spd', short: 'SPD', name: 'Sozialdemokratische Partei Deutschlands' },
  { id: 'union', short: 'CDU/CSU', name: 'CDU/CSU' },
];

export const programUrl = (party, page) => `programme/${party}.pdf#page=${page}`;
