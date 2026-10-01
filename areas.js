// Search areas for the scraper. Run one with: npm run scrape -- --area <key>
//
// To add an area: add an entry with a label, county, state and locality list.
// `bounds` is optional — when set, every query is restricted to that rectangle
// so results from neighbouring areas don't leak in.

export const AREAS = {
  sfv: {
    label: 'San Fernando Valley',
    county: 'Los Angeles',
    state: 'CA',
    bounds: {
      low:  { latitude: 34.115, longitude: -118.72 },
      high: { latitude: 34.35,  longitude: -118.18 },
    },
    localities: [
      'Burbank', 'Glendale', 'Van Nuys', 'Sherman Oaks', 'Encino', 'Studio City',
      'North Hollywood', 'Northridge', 'Reseda', 'Chatsworth',
      // West Valley
      'Canoga Park', 'Woodland Hills', 'Tarzana', 'Winnetka', 'West Hills', 'Lake Balboa', 'Calabasas',
      // North Valley
      'Granada Hills', 'Porter Ranch', 'Mission Hills', 'North Hills', 'Panorama City',
      'Pacoima', 'Sylmar', 'San Fernando', 'Arleta',
      // East Valley
      'Sun Valley', 'Valley Village', 'Valley Glen', 'Toluca Lake', 'Sunland-Tujunga', 'Universal City',
    ],
  },

  'santa-barbara': {
    label: 'Santa Barbara County',
    county: 'Santa Barbara',
    state: 'CA',
    localities: ['Santa Barbara', 'Goleta', 'Carpinteria', 'Lompoc', 'Santa Maria', 'Solvang', 'Buellton', 'Orcutt'],
  },

  ventura: {
    label: 'Ventura County',
    county: 'Ventura',
    state: 'CA',
    localities: [
      'Ventura', 'Oxnard', 'Camarillo', 'Thousand Oaks', 'Simi Valley', 'Moorpark',
      'Fillmore', 'Ojai', 'Port Hueneme', 'Westlake Village',
    ],
  },

  'san-luis-obispo': {
    label: 'San Luis Obispo County',
    county: 'San Luis Obispo',
    state: 'CA',
    localities: [
      'San Luis Obispo', 'Paso Robles', 'Atascadero', 'Arroyo Grande', 'Grover Beach',
      'Pismo Beach', 'Morro Bay', 'Templeton', 'Nipomo',
    ],
  },

  'contra-costa': {
    label: 'Contra Costa County',
    county: 'Contra Costa',
    state: 'CA',
    localities: [
      'Concord', 'Antioch', 'Richmond', 'San Ramon', 'Walnut Creek', 'Pittsburg', 'Brentwood',
      'Danville', 'Pleasant Hill', 'Martinez', 'Oakley', 'Hercules', 'El Cerrito', 'Lafayette',
      'Pinole', 'Orinda', 'Clayton', 'Moraga',
    ],
  },
};
