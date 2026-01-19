import { sumCredits } from './grade'

const DEFAULT_LIMIT = 5

export const AGENT_TOOLS = [
  {
    name: 'get_total_credits',
    description:
      '计算已修学分总和（不含虚拟学分）。当用户询问“修了多少学分”或需要学分口径时使用。可按需排除拓展课程组或公选课，返回总学分与课程数量，便于后续分析。',
    parameters: {
      excludeExpansion: 'boolean 可选，是否排除拓展课程组',
      excludeElective: 'boolean 可选，是否排除通识公选课'
    }
  },
  {
    name: 'get_summary',
    description:
      '返回当前成绩概览（加权均分、加权绩点、课程数、学分等）。当用户需要整体表现概览或“当前平均分/绩点是多少”时使用。结果包含趋势与分布，适合用于生成诊断与建议。',
    parameters: {}
  },
  {
    name: 'search_courses',
    description:
      '按关键词搜索课程，可匹配课程名称、学年、学期、课程代码或开课学院。用于查找某类课程、某学期课程或核对具体课程表现。返回课程名、学分、成绩、绩点、学期与标记。',
    parameters: {
      keyword: 'string 必填，课程关键词',
      limit: 'number 可选，返回条数'
    }
  },
  {
    name: 'get_course_detail',
    description:
      '获取单门课程详情，包括分项成绩与规则后分数。用于解释单门课程表现或核对课程细节。若多门命中会返回候选列表，需用户确认具体课程。',
    parameters: {
      name: 'string 必填，课程名称或关键词'
    }
  },
  {
    name: 'get_ranked_courses',
    description:
      '按成绩排序返回课程列表（高分或低分）。用于找出拉低平均分的课程或识别优势课程，便于针对性改进。',
    parameters: {
      order: 'string 必填，可选值 top/bottom',
      limit: 'number 可选，返回条数'
    }
  },
  {
    name: 'get_term_summary',
    description:
      '按学期汇总平均分与学分。用于回答“每学期表现如何”或“学期趋势”类问题。可指定返回最近若干学期。',
    parameters: {
      limit: 'number 可选，仅返回最近若干学期'
    }
  },
  {
    name: 'calc_required_avg',
    description:
      '计算在未来学期修读一定学分时，为达到目标总平均分所需的学期平均分。适用于“保持95/96以上还需要多少”之类问题。可选择口径（weighted/actual），不传则返回两种口径。',
    parameters: {
      targetAverage: 'number 必填，目标总平均分',
      nextCredits: 'number 必填，下学期计划修读学分',
      currentAverage: 'number 可选，当前总平均分（默认使用当前加权均分）',
      currentCredits: 'number 可选，当前已修学分（默认使用当前口径下学分）',
      mode: 'string 可选，weighted/actual，默认同时返回'
    }
  }
]

export function createToolRunner({
  courses,
  derivedCourses,
  analysisCourses,
  ruleSet,
  stats,
  distribution,
  trend,
  useFilter,
  useMultiplier
}) {
  const safeNumber = (value, fallback = 0) => {
    const num = Number(value)
    return Number.isNaN(num) ? fallback : num
  }

  const safeLimit = (value) => {
    const limit = safeNumber(value, DEFAULT_LIMIT)
    return Math.min(Math.max(Math.floor(limit || DEFAULT_LIMIT), 1), 20)
  }

  const normalizeText = (value) => {
    if (value === null || value === undefined) return ''
    return String(value).trim()
  }

  const normalizeForSearch = (value) => {
    return normalizeText(value)
      .toLowerCase()
      .replace(/[—–]/g, '-')
      .replace(/\s+/g, ' ')
  }

  const buildCourseTag = (course) => {
    const tags = []
    if (course.isMultiplier) tags.push('×1.2')
    if (course.isFirstFail) tags.push('首次不及格')
    if (course.isElective) tags.push('公选课')
    if (course.isExpansion) tags.push('拓展')
    return tags
  }

  const formatTermLabel = (year, term) => {
    const yearText = year ? `${year} 学年` : '未知学年'
    const termText = term ? `第${term}学期` : ''
    return [yearText, termText].filter(Boolean).join(' ')
  }

  const parseYearStart = (value) => {
    const match = String(value).match(/(\d{4})/)
    return match ? Number(match[1]) : 0
  }

  const parseTerm = (value) => {
    const text = String(value || '').trim()
    const match = text.match(/\d+/)
    if (match) return Number(match[0])
    const map = { '一': 1, '二': 2, '三': 3, '四': 4 }
    for (const [k, v] of Object.entries(map)) {
      if (text.includes(k)) return v
    }
    return 0
  }

  const listCourses = derivedCourses || []
  const listAnalysis = analysisCourses || []
  const listBase = courses || []

  return function runTool(toolName, args = {}) {
    switch (toolName) {
      case 'get_total_credits': {
        const excludeExpansion = Boolean(args.excludeExpansion)
        const excludeElective = Boolean(args.excludeElective)
        const total = sumCredits(listBase, ruleSet, {
          excludeExpansion,
          excludeElective
        })
        return {
          totalCredits: Number(total.toFixed(1)),
          courseCount: listBase.length,
          scope: {
            excludeExpansion,
            excludeElective
          }
        }
      }
      case 'get_summary': {
        const totalCredits = sumCredits(listBase, ruleSet, {})
        const filteredCredits = sumCredits(listBase, ruleSet, {
          excludeExpansion: useFilter
        })
        return {
          avgScore: Number(stats.avgScore.toFixed(2)),
          avgGpa: Number(stats.avgGpa.toFixed(2)),
          weightedCredits: Number(stats.weightedCredits.toFixed(1)),
          totalCredits: Number(totalCredits.toFixed(1)),
          filteredCredits: Number(filteredCredits.toFixed(1)),
          courseCount: listBase.length,
          useFilter,
          useMultiplier,
          distribution,
          trend
        }
      }
      case 'search_courses': {
        const keyword = normalizeText(args.keyword)
        if (!keyword) {
          return { error: '请提供 keyword 参数。' }
        }
        const limit = safeLimit(args.limit)
        const normalizedKeyword = normalizeForSearch(keyword)
        const keywordTokens = normalizedKeyword.split(' ').filter(Boolean)
        const matches = listCourses
          .filter((course) => {
            const year = course.year || ''
            const term = course.term || ''
            const haystack = normalizeForSearch(
              [
                course.name,
                course.code,
                course.college,
                course.className,
                year,
                term,
                `${year} ${term}`,
                `${year}学年`,
                `第${term}学期`
              ]
                .filter(Boolean)
                .join(' ')
            )
            const compactHaystack = haystack.replace(/\s+/g, '')

            if (keywordTokens.length > 1) {
              return keywordTokens.every((token) => {
                const compactToken = token.replace(/\s+/g, '')
                return haystack.includes(token) || compactHaystack.includes(compactToken)
              })
            }

            const compactKeyword = normalizedKeyword.replace(/\s+/g, '')
            return (
              haystack.includes(normalizedKeyword) ||
              compactHaystack.includes(compactKeyword)
            )
          })
          .slice(0, limit)
          .map((course) => ({
            课程: course.name,
            学分: course.credit || 0,
            成绩: course.effectiveScore ?? null,
            绩点: course.gpa ?? null,
            学期: formatTermLabel(course.year, course.term),
            标记: buildCourseTag(course)
          }))
        return {
          keyword,
          total: matches.length,
          items: matches
        }
      }
      case 'get_course_detail': {
        const name = normalizeText(args.name)
        if (!name) {
          return { error: '请提供 name 参数。' }
        }
        const hits = listCourses.filter((course) => course.name.includes(name))
        if (!hits.length) {
          return { error: '未找到匹配课程。' }
        }
        if (hits.length > 1) {
          return {
            multiple: true,
            candidates: hits.slice(0, 8).map((course) => ({
              课程: course.name,
              学期: formatTermLabel(course.year, course.term),
              学分: course.credit || 0
            }))
          }
        }
        const course = hits[0]
        return {
          课程: course.name,
          学期: formatTermLabel(course.year, course.term),
          学分: course.credit || 0,
          原始总评: course.totalScore ?? null,
          规则后总评: course.effectiveScore ?? null,
          绩点: course.gpa ?? null,
          标记: buildCourseTag(course),
          分项: (course.parts || []).map((part) => ({
            名称: part.name || '未命名',
            分数: part.score ?? null,
            比例: part.weight ?? null
          }))
        }
      }
      case 'get_ranked_courses': {
        const order = normalizeText(args.order) || 'top'
        const limit = safeLimit(args.limit)
        const ranked = listCourses
          .filter((course) => course.effectiveScore !== null)
          .sort((a, b) => {
            if (order === 'bottom') return a.effectiveScore - b.effectiveScore
            return b.effectiveScore - a.effectiveScore
          })
          .slice(0, limit)
          .map((course) => ({
            课程: course.name,
            成绩: course.effectiveScore ?? null,
            学分: course.credit || 0,
            学期: formatTermLabel(course.year, course.term),
            标记: buildCourseTag(course)
          }))
        return {
          order: order === 'bottom' ? 'low' : 'high',
          items: ranked
        }
      }
      case 'get_term_summary': {
        const map = new Map()
        listAnalysis.forEach((course) => {
          const key = `${course.year || '未知'}|${course.term || ''}`
          if (!map.has(key)) {
            map.set(key, {
              year: course.year || '未知',
              term: course.term || '',
              credits: 0,
              totalScore: 0,
              scoredCredits: 0
            })
          }
          const entry = map.get(key)
          const credit = course.credit || 0
          entry.credits += credit
          if (course.effectiveScore !== null && credit) {
            entry.totalScore += course.effectiveScore * credit
            entry.scoredCredits += credit
          }
        })

        const items = Array.from(map.values())
        items.sort((a, b) => {
          const aYear = parseYearStart(a.year)
          const bYear = parseYearStart(b.year)
          if (aYear !== bYear) return aYear - bYear
          return parseTerm(a.term) - parseTerm(b.term)
        })

        const limit = safeLimit(args.limit || items.length)
        const sliced = items.slice(-limit)
        return {
          scope: {
            useFilter,
            useMultiplier
          },
          items: sliced.map((item) => ({
            学期: formatTermLabel(item.year, item.term),
            学分: Number(item.credits.toFixed(1)),
            平均分: item.scoredCredits
              ? Number((item.totalScore / item.scoredCredits).toFixed(2))
              : null
          }))
        }
      }
      case 'calc_required_avg': {
        const targetAverage = safeNumber(args.targetAverage, null)
        const nextCredits = safeNumber(args.nextCredits, null)
        if (targetAverage === null || nextCredits === null || nextCredits <= 0) {
          return { error: '请提供有效的 targetAverage 与 nextCredits。' }
        }

        const mode = normalizeText(args.mode || '')
        const hasCurrentAverage = args.currentAverage !== undefined && args.currentAverage !== null
        const hasCurrentCredits = args.currentCredits !== undefined && args.currentCredits !== null

        const weightedCurrentAverage = hasCurrentAverage
          ? safeNumber(args.currentAverage, stats.avgScore)
          : stats.avgScore
        const weightedCurrentCredits = hasCurrentCredits
          ? safeNumber(args.currentCredits, stats.weightedCredits)
          : stats.weightedCredits

        const actualCurrentAverage = hasCurrentAverage
          ? safeNumber(args.currentAverage, stats.avgScore)
          : stats.avgScore
        const actualCurrentCredits = hasCurrentCredits
          ? safeNumber(args.currentCredits, sumCredits(listBase, ruleSet, {}))
          : sumCredits(listBase, ruleSet, {})

        const calcRequired = (currentAverage, currentCredits) => {
          const totalCredits = currentCredits + nextCredits
          if (!totalCredits) return null
          const required =
            (targetAverage * totalCredits - currentAverage * currentCredits) /
            nextCredits
          return Number(required.toFixed(2))
        }

        const weightedRequired = calcRequired(weightedCurrentAverage, weightedCurrentCredits)
        const actualRequired = calcRequired(actualCurrentAverage, actualCurrentCredits)

        if (mode === 'weighted') {
          return {
            口径: 'weighted',
            当前平均分: Number(weightedCurrentAverage.toFixed(2)),
            当前学分: Number(weightedCurrentCredits.toFixed(1)),
            目标平均分: Number(targetAverage.toFixed(2)),
            下学期学分: Number(nextCredits.toFixed(1)),
            需要的学期平均分: weightedRequired
          }
        }

        if (mode === 'actual') {
          return {
            口径: 'actual',
            当前平均分: Number(actualCurrentAverage.toFixed(2)),
            当前学分: Number(actualCurrentCredits.toFixed(1)),
            目标平均分: Number(targetAverage.toFixed(2)),
            下学期学分: Number(nextCredits.toFixed(1)),
            需要的学期平均分: actualRequired
          }
        }

        return {
          目标平均分: Number(targetAverage.toFixed(2)),
          下学期学分: Number(nextCredits.toFixed(1)),
          基于加权口径: {
            当前平均分: Number(weightedCurrentAverage.toFixed(2)),
            当前学分: Number(weightedCurrentCredits.toFixed(1)),
            需要的学期平均分: weightedRequired
          },
          基于实际学分口径: {
            当前平均分: Number(actualCurrentAverage.toFixed(2)),
            当前学分: Number(actualCurrentCredits.toFixed(1)),
            需要的学期平均分: actualRequired
          }
        }
      }
      default:
        return { error: `未知工具: ${toolName}` }
    }
  }
}

export function extractToolCall(text) {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed) return null

  const direct = parseJson(trimmed)
  if (direct?.tool) return direct

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    const parsed = parseJson(fenced[1])
    if (parsed?.tool) return parsed
  }

  const match = trimmed.match(/\{[\s\S]*\}/)
  if (match) {
    const parsed = parseJson(match[0])
    if (parsed?.tool) return parsed
  }

  return null
}

function parseJson(text) {
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object') return parsed
  } catch (err) {
    return null
  }
  return null
}
