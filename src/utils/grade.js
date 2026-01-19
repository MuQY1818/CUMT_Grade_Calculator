import { MULTIPLIER_KEYWORDS, WORD_SCORE_MAP } from './constants'

export function normalizeText(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

export function parseWeight(label) {
  if (!label) return null
  const match = String(label).match(/(\d+(?:\.\d+)?)\s*%/)
  if (!match) return null
  const value = Number(match[1])
  if (Number.isNaN(value)) return null
  return value / 100
}

export function parseScore(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number' && !Number.isNaN(value)) return value
  const text = normalizeText(value)
  if (text === '') return null
  if (WORD_SCORE_MAP[text] !== undefined) return WORD_SCORE_MAP[text]
  const numeric = Number(text)
  if (!Number.isNaN(numeric)) return numeric
  return null
}

export function scoreToGpa(score) {
  if (score === null || score === undefined || Number.isNaN(score)) return 0
  const s = Number(score)
  if (s >= 95) return 5.0
  if (s >= 90) return 4.5
  if (s >= 85) return 4.0
  if (s >= 82) return 3.5
  if (s >= 78) return 3.0
  if (s >= 75) return 2.8
  if (s >= 72) return 2.5
  if (s >= 68) return 2.0
  if (s >= 65) return 1.5
  if (s >= 60) return 1.0
  return 0
}

export function aggregateCourses(rows) {
  const map = new Map()

  rows.forEach((row) => {
    const year = normalizeText(row['学年'])
    const term = normalizeText(row['学期'])
    const college = normalizeText(row['开课学院'])
    const code = normalizeText(row['课程代码'])
    const name = normalizeText(row['课程名称'])
    const className = normalizeText(row['教学班'])
    const credit = Number(row['学分']) || 0
    const item = normalizeText(row['成绩分项'])
    const score = parseScore(row['成绩'])

    if (!name && !code) return

    const key = [year, term, code, className || name].filter(Boolean).join('|')
    const existing = map.get(key) || {
      key,
      year,
      term,
      college,
      code,
      name,
      className,
      credit,
      parts: [],
      totalScore: null
    }

    if (!existing.credit && credit) existing.credit = credit
    if (!existing.name && name) existing.name = name

    const isTotal = item.includes('总评')
    if (isTotal && score !== null) {
      existing.totalScore = score
    } else if (item) {
      const weight = parseWeight(item)
      existing.parts.push({ name: item, score, weight })
    }

    map.set(key, existing)
  })

  const courses = Array.from(map.values())
  courses.forEach((course) => {
    if (course.totalScore !== null) return
    const validParts = course.parts.filter((p) => p.score !== null)
    if (!validParts.length) return
    const weighted = validParts.filter((p) => typeof p.weight === 'number')
    if (weighted.length) {
      const sumWeight = weighted.reduce((acc, p) => acc + p.weight, 0)
      const sumScore = weighted.reduce((acc, p) => acc + p.score * p.weight, 0)
      course.totalScore = sumWeight ? sumScore / sumWeight : null
    } else {
      const sumScore = validParts.reduce((acc, p) => acc + p.score, 0)
      course.totalScore = sumScore / validParts.length
    }
  })

  return courses
}

export function buildDefaultMultiplier(courses, existing = {}) {
  const result = { ...existing }
  courses.forEach((course) => {
    if (result[course.key] !== undefined) return
    const hit = MULTIPLIER_KEYWORDS.some((kw) => course.name.includes(kw))
    if (hit) result[course.key] = true
  })
  return result
}

export function toRuleSet(ruleState) {
  const toSet = (obj) => new Set(Object.keys(obj).filter((k) => obj[k]))
  return {
    multiplier: toSet(ruleState.multiplier || {}),
    elective: toSet(ruleState.elective || {}),
    firstFail: toSet(ruleState.firstFail || {}),
    expansion: toSet(ruleState.expansion || {})
  }
}

export function applyCourseRules(course, ruleSet, useMultiplier) {
  let effectiveScore = course.totalScore
  if (ruleSet.firstFail.has(course.key)) {
    effectiveScore = 60
  }

  let multiplier = 1
  if (useMultiplier && ruleSet.multiplier.has(course.key) && effectiveScore !== null) {
    multiplier = 1.2
    effectiveScore *= multiplier
  }

  const gpa = scoreToGpa(effectiveScore)
  const weightCredit = course.credit || 0

  return {
    effectiveScore,
    gpa,
    multiplier,
    weightCredit
  }
}

export function computeStats(courses, ruleSet, options) {
  const { useFilter, useMultiplier } = options
  let baseCourses = courses
  let electiveCourses = []

  if (useFilter) {
    baseCourses = courses.filter(
      (course) => !ruleSet.expansion.has(course.key) && !ruleSet.elective.has(course.key)
    )
    electiveCourses = courses.filter(
      (course) => !ruleSet.expansion.has(course.key) && ruleSet.elective.has(course.key)
    )
  }

  let sumScore = 0
  let sumGpa = 0
  let sumWeight = 0
  let totalCredits = 0

  baseCourses.forEach((course) => {
    const { effectiveScore, gpa } = applyCourseRules(course, ruleSet, useMultiplier)
    if (effectiveScore === null || !course.credit) return
    const credit = course.credit || 0
    sumScore += effectiveScore * credit
    sumGpa += gpa * credit
    sumWeight += credit
    totalCredits += credit
  })

  if (useFilter && electiveCourses.length) {
    const electiveScores = electiveCourses
      .map((course) => applyCourseRules(course, ruleSet, useMultiplier).effectiveScore)
      .filter((score) => score !== null)
    if (electiveScores.length) {
      const avgElective =
        electiveScores.reduce((acc, s) => acc + s, 0) / electiveScores.length
      const virtualCredit = 10
      sumScore += avgElective * virtualCredit
      sumGpa += scoreToGpa(avgElective) * virtualCredit
      sumWeight += virtualCredit
      totalCredits += virtualCredit
    }
  }

  return {
    avgScore: sumWeight ? sumScore / sumWeight : 0,
    avgGpa: sumWeight ? sumGpa / sumWeight : 0,
    totalCredits,
    weightedCredits: sumWeight
  }
}

export function sumCredits(courses, ruleSet, options = {}) {
  const { excludeExpansion = false, excludeElective = false } = options
  return courses.reduce((sum, course) => {
    if (excludeExpansion && ruleSet.expansion.has(course.key)) return sum
    if (excludeElective && ruleSet.elective.has(course.key)) return sum
    return sum + (course.credit || 0)
  }, 0)
}

export function buildDistribution(courses) {
  const buckets = [
    { label: '90+', min: 90, max: Infinity },
    { label: '80-89', min: 80, max: 89.99 },
    { label: '70-79', min: 70, max: 79.99 },
    { label: '60-69', min: 60, max: 69.99 },
    { label: '<60', min: -Infinity, max: 59.99 }
  ]
  const result = buckets.map((b) => ({ label: b.label, count: 0 }))
  courses.forEach((course) => {
    if (course.effectiveScore === null) return
    const score = course.effectiveScore
    const bucketIndex = buckets.findIndex((b) => score >= b.min && score <= b.max)
    if (bucketIndex >= 0) result[bucketIndex].count += 1
  })
  return result
}

export function buildTermTrend(courses) {
  const map = new Map()
  courses.forEach((course) => {
    if (course.effectiveScore === null) return
    const year = course.year || '未知'
    const term = course.term || ''
    const key = `${year}|${term}`
    if (!map.has(key)) {
      map.set(key, { year, term, weightedTotal: 0, totalCredits: 0 })
    }
    const entry = map.get(key)
    entry.weightedTotal += course.effectiveScore * (course.credit || 0)
    entry.totalCredits += course.credit || 0
  })

  const items = Array.from(map.values())
  items.sort((a, b) => {
    const aYear = parseYearStart(a.year)
    const bYear = parseYearStart(b.year)
    if (aYear !== bYear) return aYear - bYear
    const aTerm = parseTerm(a.term)
    const bTerm = parseTerm(b.term)
    return aTerm - bTerm
  })

  return items.map((item) => ({
    term: formatTermLabel(item.year, item.term),
    avg: item.totalCredits ? item.weightedTotal / item.totalCredits : 0
  }))
}

function parseYearStart(value) {
  const match = String(value).match(/(\d{4})/)
  return match ? Number(match[1]) : 0
}

function parseTerm(value) {
  const s = String(value).trim()
  const match = s.match(/\d+/)
  if (match) return Number(match[0])
  
  const map = { '一': 1, '二': 2, '三': 3, '四': 4 }
  for (const [k, v] of Object.entries(map)) {
    if (s.includes(k)) return v
  }
  return 0
}

function formatTermLabel(year, term) {
  const yearText = year ? `${year} 学年` : '未知学年'
  const termText = term ? `第${term}学期` : ''
  return [yearText, termText].filter(Boolean).join(' ')
}
