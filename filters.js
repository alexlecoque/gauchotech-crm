// Chain and non-pizza filters. Neo O1 targets independent pizza shops.
import { normName } from './match.js';

// Matched as whole phrases against the normalized name ("Domino's Pizza" → "dominos pizza"),
// so "mod pizza" does not block "Modern Pizza".
const CHAINS = [
  'dominos', 'pizza hut', 'papa johns', 'little caesars', 'papa murphys', 'round table', 'sbarro', 'cicis',
  'mod pizza', 'blaze pizza', 'pieology', 'mountain mikes', 'marcos pizza', 'jets pizza', 'hungry howies',
  'chuck e cheese', 'california pizza kitchen', 'shakeys', 'numero uno', 'ameci', 'fresh brothers',
  'big mamas and papas', 'zpizza', 'z pizza', 'pitfire', 'straw hat', 'costco',
];

// A name seen this many times in one run is probably a chain we don't know about
export const SUSPECTED_CHAIN_MIN = 4;

const PIZZA_TYPES = ['pizza_restaurant', 'pizza_delivery'];

const NON_PIZZA_TYPES = [
  'bar', 'pub', 'wine_bar', 'cocktail_bar', 'sports_bar', 'bar_and_grill', 'brewery', 'brewpub', 'beer_garden',
  'night_club', 'liquor_store', 'grocery_store', 'supermarket', 'convenience_store', 'gas_station',
  'warehouse_store', 'bowling_alley', 'amusement_center',
];

const NON_PIZZA_NAME = /\b(brewery|brewing|brewpub|brewhouse|taproom|tap room|tavern|pub|saloon|sports bar|bar and grill)\b/;

export function chainMatch(name) {
  const norm = ` ${normName(name)} `;
  return CHAINS.find(c => norm.includes(` ${c} `)) || null;
}

// Returns a reason string when the place is not a pizza shop, otherwise null
export function notPizzaReason(place) {
  const name = normName(place.displayName?.text);
  const primary = place.primaryType || '';

  if (NON_PIZZA_TYPES.includes(primary)) return `primary type is ${primary}`;
  const word = name.match(NON_PIZZA_NAME);
  if (word) return `name contains "${word[1]}"`;

  if (PIZZA_TYPES.includes(primary)) return null;
  const pizzaName = /\b(pizza|pizzas|pizzeria)\b/.test(name);
  const restaurantType = !primary || primary === 'restaurant' || primary.endsWith('_restaurant')
    || primary === 'meal_takeaway' || primary === 'meal_delivery';
  if (pizzaName && restaurantType) return null;

  return pizzaName ? `primary type is ${primary}` : `primary type is ${primary || 'unknown'} and no pizza in name`;
}
