import type { WeatherData, VigilanceLevel, FireRiskLevel } from '../types'

const LAT = 42.9375
const LNG = 1.7452

const WMO_ICONS: Record<number, { label: string; emoji: string }> = {
  0:  { label: 'Ciel dégagé',    emoji: '☀️' },
  1:  { label: 'Peu nuageux',    emoji: '🌤️' },
  2:  { label: 'Partiellement nuageux', emoji: '⛅' },
  3:  { label: 'Couvert',        emoji: '☁️' },
  45: { label: 'Brouillard',     emoji: '🌫️' },
  48: { label: 'Brouillard givrant', emoji: '🌫️' },
  51: { label: 'Bruine légère',  emoji: '🌦️' },
  53: { label: 'Bruine',         emoji: '🌦️' },
  55: { label: 'Bruine forte',   emoji: '🌧️' },
  61: { label: 'Pluie légère',   emoji: '🌧️' },
  63: { label: 'Pluie',          emoji: '🌧️' },
  65: { label: 'Pluie forte',    emoji: '🌧️' },
  71: { label: 'Neige légère',   emoji: '🌨️' },
  73: { label: 'Neige',          emoji: '❄️' },
  75: { label: 'Neige forte',    emoji: '❄️' },
  77: { label: 'Grains de neige', emoji: '🌨️' },
  80: { label: 'Averses légères', emoji: '🌦️' },
  81: { label: 'Averses',        emoji: '🌧️' },
  82: { label: 'Averses fortes', emoji: '⛈️' },
  85: { label: 'Averses de neige', emoji: '🌨️' },
  86: { label: 'Averses de neige fortes', emoji: '❄️' },
  95: { label: 'Orage',          emoji: '⛈️' },
  96: { label: 'Orage avec grêle', emoji: '⛈️' },
  99: { label: 'Orage violent',  emoji: '⛈️' },
}

export function getWeatherInfo(code: number) {
  return WMO_ICONS[code] ?? WMO_ICONS[Math.floor(code / 10) * 10] ?? { label: 'Inconnu', emoji: '🌡️' }
}

/* ─── Vigilance météo (estimée depuis Open-Meteo) ─── */

export function computeVigilance(data: WeatherData): VigilanceLevel {
  const { windGusts, precipitation, maxTemp, minTemp, weatherCode } = data

  // Vent violent
  if (windGusts > 100) return 'Rouge'
  if (windGusts > 80)  return 'Orange'
  if (windGusts > 58)  return 'Jaune'

  // Pluie / inondations
  if (precipitation > 30)  return 'Orange'
  if (precipitation > 15)  return 'Jaune'

  // Orage (codes WMO 95-99)
  if (weatherCode >= 95) return 'Orange'

  // Grand froid
  if (minTemp < -10) return 'Orange'
  if (minTemp < -5)  return 'Jaune'

  // Canicule
  if (maxTemp > 40) return 'Orange'
  if (maxTemp > 36) return 'Jaune'

  return 'Vert'
}

/* ─── Risque incendie (estimé depuis données météo) ─── */

export function computeFireRisk(data: WeatherData): FireRiskLevel {
  const month = new Date().getMonth() // 0-11
  if (month < 4 || month > 9) return 'Faible' // hors saison (oct-avr)

  const { maxTemp, windSpeed, humidity, precipitation } = data

  // Pas de risque si pluie significative
  if (precipitation > 5) return 'Faible'

  const score =
    (maxTemp > 35 ? 3 : maxTemp > 30 ? 2 : maxTemp > 25 ? 1 : 0) +
    (windSpeed > 50 ? 3 : windSpeed > 30 ? 2 : windSpeed > 15 ? 1 : 0) +
    (humidity < 20 ? 3 : humidity < 35 ? 2 : humidity < 50 ? 1 : 0)

  if (score >= 7) return 'Très élevé'
  if (score >= 5) return 'Élevé'
  if (score >= 3) return 'Modéré'
  return 'Faible'
}

/* ─── Fetch principal ─── */

export async function fetchWeather(): Promise<WeatherData> {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude',  String(LAT))
  url.searchParams.set('longitude', String(LNG))
  url.searchParams.set('current', [
    'temperature_2m',
    'precipitation',
    'wind_speed_10m',
    'wind_gusts_10m',
    'relative_humidity_2m',
    'weather_code',
  ].join(','))
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min')
  url.searchParams.set('timezone', 'Europe/Paris')
  url.searchParams.set('forecast_days', '1')

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error('Météo indisponible')

  const data = await res.json()
  return {
    temperature:  Math.round(data.current.temperature_2m),
    windSpeed:    Math.round(data.current.wind_speed_10m),
    windGusts:    Math.round(data.current.wind_gusts_10m ?? 0),
    precipitation: data.current.precipitation,
    humidity:     data.current.relative_humidity_2m ?? 50,
    weatherCode:  data.current.weather_code,
    maxTemp:      Math.round(data.daily.temperature_2m_max[0]),
    minTemp:      Math.round(data.daily.temperature_2m_min[0]),
  }
}
