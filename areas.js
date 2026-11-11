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

  sgv: {
    label: 'San Gabriel Valley',
    county: 'Los Angeles',
    state: 'CA',
    bounds: {
      low:  { latitude: 34.00, longitude: -118.21 },
      high: { latitude: 34.23, longitude: -117.80 },
    },
    localities: [
      'Pasadena', 'Altadena', 'South Pasadena', 'Alhambra', 'San Gabriel', 'San Marino', 'Arcadia', 'Monrovia',
      'Temple City', 'Rosemead', 'El Monte', 'Duarte', 'Azusa', 'Glendora', 'Covina', 'West Covina', 'Baldwin Park',
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
      'Fillmore', 'Ojai', 'Port Hueneme', 'Westlake Village', 'Newbury Park', 'Santa Paula', 'Oak Park',
    ],
  },

  'san-luis-obispo': {
    label: 'San Luis Obispo County',
    county: 'San Luis Obispo',
    state: 'CA',
    localities: [
      'San Luis Obispo', 'Paso Robles', 'Atascadero', 'Arroyo Grande', 'Grover Beach',
      'Pismo Beach', 'Morro Bay', 'Templeton', 'Nipomo', 'Los Osos', 'Cambria', 'Cayucos',
    ],
  },

  monterey: {
    label: 'Monterey County',
    county: 'Monterey',
    state: 'CA',
    bounds: {
      low:  { latitude: 36.05, longitude: -122.10 },
      high: { latitude: 36.95, longitude: -121.00 },
    },
    localities: [
      'Salinas', 'Monterey', 'Seaside', 'Marina', 'Pacific Grove', 'Carmel-by-the-Sea', 'Carmel Valley',
      'Castroville', 'Gonzales', 'Soledad', 'Greenfield', 'King City',
    ],
  },

  'santa-cruz': {
    label: 'Santa Cruz County',
    county: 'Santa Cruz',
    state: 'CA',
    bounds: {
      low:  { latitude: 36.85, longitude: -122.35 },
      high: { latitude: 37.30, longitude: -121.55 },
    },
    localities: ['Santa Cruz', 'Watsonville', 'Capitola', 'Aptos', 'Scotts Valley', 'Soquel', 'Felton'],
  },

  'oc-north': {
    label: 'North Orange County',
    county: 'Orange',
    state: 'CA',
    bounds: {
      low:  { latitude: 33.60, longitude: -118.13 },
      high: { latitude: 33.96, longitude: -117.70 },
    },
    localities: [
      'Anaheim', 'Fullerton', 'Orange', 'Santa Ana', 'Tustin', 'Garden Grove', 'Westminster', 'Fountain Valley',
      'Huntington Beach', 'Costa Mesa', 'Buena Park', 'Cypress', 'Stanton', 'La Palma', 'Los Alamitos', 'Seal Beach',
      'La Habra', 'Brea', 'Placentia', 'Yorba Linda',
    ],
  },

  'long-beach': {
    label: 'Long Beach / Gateway Cities',
    county: 'Los Angeles',
    state: 'CA',
    bounds: {
      low:  { latitude: 33.70, longitude: -118.25 },
      high: { latitude: 34.03, longitude: -117.98 },
    },
    localities: [
      'Long Beach', 'Signal Hill', 'Lakewood', 'Bellflower', 'Paramount', 'Downey', 'Norwalk', 'Cerritos',
      'Artesia', 'Whittier',
    ],
  },

  'south-bay': {
    label: 'South Bay',
    county: 'Los Angeles',
    state: 'CA',
    bounds: {
      low:  { latitude: 33.70, longitude: -118.45 },
      high: { latitude: 33.95, longitude: -118.22 },
    },
    localities: [
      'Torrance', 'Redondo Beach', 'Hermosa Beach', 'Manhattan Beach', 'El Segundo', 'Gardena', 'Hawthorne',
      'Lawndale', 'Carson', 'Lomita', 'Harbor City', 'San Pedro', 'Wilmington', 'Palos Verdes Estates',
      'Rancho Palos Verdes',
    ],
  },

  'oc-south': {
    label: 'South Orange County',
    county: 'Orange',
    state: 'CA',
    bounds: {
      low:  { latitude: 33.37, longitude: -117.98 },
      high: { latitude: 33.76, longitude: -117.55 },
    },
    localities: [
      'Irvine', 'Newport Beach', 'Laguna Beach', 'Laguna Niguel', 'Laguna Hills', 'Aliso Viejo', 'Mission Viejo',
      'Lake Forest', 'Rancho Santa Margarita', 'Ladera Ranch', 'San Juan Capistrano', 'San Clemente', 'Dana Point',
    ],
  },

  'la-central': {
    label: 'Central / West Los Angeles',
    county: 'Los Angeles',
    state: 'CA',
    // sits between the SFV box (north, 34.115), the SGV box (east, -118.21), the South Bay box (south, 33.95)
    // and the Long Beach / Gateway box (east, -118.25) — none of them overlap
    bounds: {
      low:  { latitude: 33.95,  longitude: -118.52 },
      high: { latitude: 34.115, longitude: -118.25 },
    },
    localities: [
      'Hollywood', 'West Hollywood', 'Downtown Los Angeles', 'Silver Lake', 'Echo Park', 'Mid-City', 'Koreatown',
      'Westwood', 'Santa Monica', 'Venice', 'Culver City', 'Mar Vista', 'Inglewood', 'South Los Angeles',
      'Huntington Park',
    ],
  },

  'sd-city': {
    label: 'San Diego City / South County',
    county: 'San Diego',
    state: 'CA',
    bounds: {
      low:  { latitude: 32.53, longitude: -117.30 },
      high: { latitude: 32.95, longitude: -116.85 },
    },
    localities: [
      'San Diego', 'La Jolla', 'Pacific Beach', 'Chula Vista', 'National City', 'El Cajon', 'La Mesa', 'Santee',
    ],
  },

  'sd-north': {
    label: 'North San Diego County',
    county: 'San Diego',
    state: 'CA',
    bounds: {
      low:  { latitude: 32.95, longitude: -117.45 },
      high: { latitude: 33.30, longitude: -116.95 },
    },
    localities: ['Oceanside', 'Carlsbad', 'Encinitas', 'Vista', 'San Marcos', 'Escondido', 'Poway'],
  },

  'inland-empire': {
    label: 'Inland Empire',
    county: 'San Bernardino',
    countyByCity: { Riverside: 'Riverside', Corona: 'Riverside' },
    state: 'CA',
    // starts at -117.70 where the North OC box ends
    bounds: {
      low:  { latitude: 33.80, longitude: -117.70 },
      high: { latitude: 34.20, longitude: -117.10 },
    },
    localities: [
      'Riverside', 'Corona', 'Ontario', 'Rancho Cucamonga', 'Upland', 'Fontana', 'San Bernardino', 'Redlands', 'Chino',
    ],
  },

  'east-bay': {
    label: 'East Bay',
    county: 'Alameda',
    state: 'CA',
    bounds: {
      low:  { latitude: 37.45, longitude: -122.35 },
      high: { latitude: 37.91, longitude: -121.85 },
    },
    localities: ['Oakland', 'Berkeley', 'Alameda', 'San Leandro', 'Hayward', 'Fremont', 'Union City'],
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
