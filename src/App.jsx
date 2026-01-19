import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { readWorkbook, workbookToRows } from './utils/excel'
import {
  aggregateCourses,
  applyCourseRules,
  buildDefaultMultiplier,
  buildDistribution,
  buildTermTrend,
  computeStats,
  sumCredits,
  toRuleSet
} from './utils/grade'
import { exportReport } from './utils/export'
import { MULTIPLIER_KEYWORDS } from './utils/constants'
import { DistributionBar, TrendLine } from './components/Charts'
import { AGENT_TOOLS, createToolRunner, extractToolCall } from './utils/agent'

const SORT_OPTIONS = [
  { id: 'name', label: '名称' },
  { id: 'score', label: '成绩' },
  { id: 'credit', label: '学分' }
]

const RULE_TABS = [
  { id: 'multiplier', label: '×1.2 公共课' },
  { id: 'elective', label: '通识公选课' },
  { id: 'firstFail', label: '首次不及格' },
  { id: 'expansion', label: '拓展课程组' }
]

const AGENT_QUICK_PROMPTS = [
  { id: 'analysis', label: '成绩诊断', prompt: '请基于当前成绩给出成绩诊断、学习规划、时间管理与职业建议。' },
  { id: 'credits', label: '已修学分', prompt: '我已经修了多少学分？' },
  { id: 'low', label: '低分课程', prompt: '列出我的低分课程。' },
  { id: 'trend', label: '学期趋势', prompt: '按学期汇总我的平均分和学分。' },
  { id: 'goal', label: '目标均分', prompt: '如果我想保持95以上，下学期修20学分需要平均分多少？' }
]

export default function App() {
  const fileInputRef = useRef(null)
  const reportRef = useRef(null)
  const aiRef = useRef(null)

  const [courses, setCourses] = useState([])
  const [importTime, setImportTime] = useState('')
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('score')
  const [sortDir, setSortDir] = useState('desc')

  const [useFilter, setUseFilter] = useState(false)
  const [useMultiplier, setUseMultiplier] = useState(false)

  const [showRules, setShowRules] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [ruleTab, setRuleTab] = useState('multiplier')
  const [ruleSearch, setRuleSearch] = useState('')

  const [rules, setRules] = useState({
    multiplier: {},
    elective: {},
    firstFail: {},
    expansion: {}
  })

  const [apiKey, setApiKey] = useState(() => localStorage.getItem('siliconflow_api_key') || '')
  const [model, setModel] = useState(() => localStorage.getItem('siliconflow_model') || '')
  const [models, setModels] = useState([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [agentNote, setAgentNote] = useState('')
  const [agentInput, setAgentInput] = useState('')
  const [agentMessages, setAgentMessages] = useState([])
  const [agentResult, setAgentResult] = useState('')
  const [agentLoading, setAgentLoading] = useState(false)
  const [agentStreamText, setAgentStreamText] = useState('')
  const [agentStreamVisible, setAgentStreamVisible] = useState(false)
  const [agentStreamHint, setAgentStreamHint] = useState('thinking')
  const [agentError, setAgentError] = useState('')
  const [selectedCourse, setSelectedCourse] = useState(null)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    localStorage.setItem('siliconflow_api_key', apiKey)
  }, [apiKey])

  useEffect(() => {
    localStorage.setItem('siliconflow_model', model)
  }, [model])

  useEffect(() => {
    if (!apiKey.trim()) {
      setModels([])
      setModelsError('')
      setModel('')
      return
    }

    const timer = setTimeout(() => {
      fetchModels()
    }, 400)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey])

  const ruleSet = useMemo(() => toRuleSet(rules), [rules])

  const derivedCourses = useMemo(() => {
    return courses.map((course) => {
      const calc = applyCourseRules(course, ruleSet, useMultiplier)
      return {
        ...course,
        ...calc,
        isMultiplier: ruleSet.multiplier.has(course.key),
        isElective: ruleSet.elective.has(course.key),
        isFirstFail: ruleSet.firstFail.has(course.key),
        isExpansion: ruleSet.expansion.has(course.key)
      }
    })
  }, [courses, ruleSet, useMultiplier])

  const stats = useMemo(() => {
    return computeStats(courses, ruleSet, { useFilter, useMultiplier })
  }, [courses, ruleSet, useFilter, useMultiplier])

  const analysisCourses = useMemo(() => {
    return derivedCourses.filter((course) => {
      if (useFilter && course.isExpansion) return false
      return true
    })
  }, [derivedCourses, useFilter])

  const filteredCourses = useMemo(() => {
    const keyword = search.trim()
    const base = analysisCourses.filter((course) => {
      if (!keyword) return true
      return course.name.includes(keyword)
    })

    const sorted = [...base].sort((a, b) => {
      let compare = 0
      if (sortBy === 'name') {
        compare = a.name.localeCompare(b.name, 'zh-Hans-CN')
      } else if (sortBy === 'credit') {
        compare = (a.credit || 0) - (b.credit || 0)
      } else {
        const aScore = a.effectiveScore ?? -1
        const bScore = b.effectiveScore ?? -1
        compare = aScore - bScore
      }
      return sortDir === 'asc' ? compare : -compare
    })

    return sorted
  }, [analysisCourses, search, sortBy, sortDir])

  const distribution = useMemo(() => buildDistribution(analysisCourses), [analysisCourses])
  const trend = useMemo(() => buildTermTrend(analysisCourses), [analysisCourses])
  const totalCredits = useMemo(() => sumCredits(courses, ruleSet, {}), [courses, ruleSet])
  const creditsWithoutExpansion = useMemo(
    () => sumCredits(courses, ruleSet, { excludeExpansion: true }),
    [courses, ruleSet]
  )
  const toolRunner = useMemo(
    () =>
      createToolRunner({
        courses,
        derivedCourses,
        analysisCourses,
        ruleSet,
        stats,
        distribution,
        trend,
        useFilter,
        useMultiplier
      }),
    [
      courses,
      derivedCourses,
      analysisCourses,
      ruleSet,
      stats,
      distribution,
      trend,
      useFilter,
      useMultiplier
    ]
  )

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    await processFile(file)
  }

  const processFile = async (file) => {
    setError('')
    setIsDragging(false)
    try {
      const workbook = await readWorkbook(file)
      const rows = workbookToRows(workbook)
      const nextCourses = aggregateCourses(rows)
      const nextMultiplier = buildDefaultMultiplier(nextCourses, rules.multiplier)

      setCourses(nextCourses)
      setRules((prev) => ({
        ...prev,
        multiplier: nextMultiplier
      }))
      setImportTime(new Date().toLocaleString('zh-CN', { hour12: false }))
      setFileName(file.name)
    } catch (err) {
      setError('读取文件失败，请确认文件格式为 .xlsx')
      console.error(err)
    }
  }

  const handleDragEnter = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    const files = e.dataTransfer.files
    if (files.length > 0) {
      const file = files[0]
      const ext = file.name.split('.').pop().toLowerCase()
      if (ext === 'xlsx' || ext === 'xls') {
        await processFile(file)
      } else {
        setError('仅支持 .xlsx 和 .xls 格式的文件')
      }
    }
  }

  const triggerFilePick = () => {
    fileInputRef.current?.click()
  }

  const toggleRule = (type, key) => {
    setRules((prev) => ({
      ...prev,
      [type]: {
        ...prev[type],
        [key]: !prev[type][key]
      }
    }))
  }

  const handleExport = async (type) => {
    if (!reportRef.current) return
    setExporting(true)
    try {
      const filename = `成绩报告_${new Date().toISOString().slice(0, 10)}`
      await exportReport({ element: reportRef.current, filename, type })
      setShowExport(false)
    } finally {
      setExporting(false)
    }
  }

  const ruleList = useMemo(() => {
    const keyword = ruleSearch.trim()
    const base = courses.filter((course) => {
      if (!keyword) return true
      return course.name.includes(keyword)
    })
    return base
  }, [courses, ruleSearch])

  const requestAgentStream = async (messages, onDelta) => {
    const response = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_tokens: 1200,
        temperature: 0.6
      })
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(text || '请求失败')
    }

    const contentType = response.headers.get('content-type') || ''
    if (!response.body || !contentType.includes('text/event-stream')) {
      const data = await response.json()
      const content = data?.choices?.[0]?.message?.content || ''
      const trimmed = content.trim()
      if (trimmed) onDelta?.(trimmed, trimmed)
      return trimmed
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let resultText = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (let line of lines) {
        line = line.trim()
        if (!line || line === 'data: [DONE]' || line === '[DONE]') continue
        if (line.startsWith('data:')) line = line.slice(5).trim()
        if (!line) continue
        try {
          const data = JSON.parse(line)
          const delta =
            data?.choices?.[0]?.delta?.content ??
            data?.choices?.[0]?.message?.content ??
            ''
          if (delta) {
            resultText += delta
            onDelta?.(delta, resultText)
          }
        } catch (err) {
          if (line.startsWith('{') && !line.endsWith('}')) {
            buffer = line + '\n' + buffer
          }
        }
      }
    }

    return resultText.trim()
  }

  const runAgentConversation = async (messages) => {
    const cleanedMessages = (messages || []).filter(
      (message) => message?.role === 'user' || message?.role === 'assistant'
    )
    const systemPrompt = buildAgentSystemPrompt({
      tools: AGENT_TOOLS,
      note: agentNote,
      useFilter,
      useMultiplier
    })
    let convo = [{ role: 'system', content: systemPrompt }, ...cleanedMessages]
    const maxToolCalls = 6
    let lastToolKey = ''
    let repeatToolCount = 0

    for (let i = 0; i < maxToolCalls; i += 1) {
      setAgentStreamText('')
      setAgentStreamVisible(false)
      setAgentStreamHint('thinking')
      let decided = false
      let suppress = false

      const assistantText = await requestAgentStream(convo, (_delta, fullText) => {
        if (!decided) {
          const trimmed = fullText.trimStart()
          const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('```json')
          const looksLikeTool = looksLikeJson && /\"tool\"\s*:/i.test(trimmed.slice(0, 160))
          if (looksLikeTool) {
            suppress = true
            decided = true
            setAgentStreamHint('tool')
            setAgentStreamVisible(false)
            setAgentStreamText('')
          } else if (trimmed.length > 0) {
            suppress = false
            decided = true
            setAgentStreamHint('answer')
          }
        }

        if (!suppress) {
          setAgentStreamVisible(true)
          setAgentStreamText(fullText)
        }
      })
      const toolCall = extractToolCall(assistantText)

      if (!toolCall) {
        return assistantText || '模型未返回内容，请稍后再试。'
      }

      const toolName = toolCall.tool
      let toolArgs = toolCall.arguments || {}
      if (typeof toolArgs === 'string') {
        try {
          toolArgs = JSON.parse(toolArgs)
        } catch (err) {
          toolArgs = {}
        }
      }
      if (!toolArgs || typeof toolArgs !== 'object') toolArgs = {}
      const toolKey = `${toolName}:${JSON.stringify(toolArgs)}`
      if (toolKey === lastToolKey) {
        repeatToolCount += 1
      } else {
        repeatToolCount = 0
        lastToolKey = toolKey
      }
      if (repeatToolCount >= 1) {
        const finalAnswer = await requestAgentStream(
          [
            ...convo,
            {
              role: 'user',
              content:
                '你刚才在重复调用工具。请停止调用工具，直接基于已有信息给出结论和建议。'
            }
          ],
          (_delta, fullText) => {
            setAgentStreamHint('answer')
            setAgentStreamVisible(true)
            setAgentStreamText(fullText)
          }
        )
        return finalAnswer || '模型未返回内容，请稍后再试。'
      }
      setAgentMessages((prev) => [
        ...prev,
        {
          role: 'tool',
          type: 'call',
          tool: toolName,
          payload: toolArgs
        }
      ])

      const toolResult = toolRunner(toolName, toolArgs)

      setAgentMessages((prev) => [
        ...prev,
        {
          role: 'tool',
          type: 'result',
          tool: toolName,
          payload: toolResult
        }
      ])

      setAgentStreamHint('tool')

      convo = [
        ...convo,
        { role: 'assistant', content: assistantText },
        {
          role: 'user',
          content: `工具结果 ${toolName}:\n${JSON.stringify(toolResult, null, 2)}`
        }
      ]
    }

    const finalAnswer = await requestAgentStream(
      [
        ...convo,
        {
          role: 'user',
          content:
            '工具调用次数已达上限，请直接基于已有信息回答，不要再调用工具。'
        }
      ],
      (_delta, fullText) => {
        setAgentStreamHint('answer')
        setAgentStreamVisible(true)
        setAgentStreamText(fullText)
      }
    )
    return finalAnswer || '模型未返回内容，请稍后再试。'
  }

  const handleAgentSend = async (overrideText) => {
    setAgentError('')
    const question = (overrideText ?? agentInput).trim()
    if (!question) return

    if (!apiKey.trim()) {
      setAgentError('请先填写 SiliconFlow API Key')
      return
    }
    if (!model) {
      setAgentError('请先获取并选择模型')
      return
    }
    if (!courses.length) {
      setAgentError('请先导入成绩数据')
      return
    }

    const baseMessages = agentMessages.filter(
      (message) => message.role === 'user' || message.role === 'assistant'
    )
    const nextMessages = [...baseMessages, { role: 'user', content: question }]
    setAgentMessages((prev) => [...prev, { role: 'user', content: question }])
    setAgentInput('')
    setAgentLoading(true)
    setAgentStreamText('')
    setAgentStreamVisible(false)
    setAgentStreamHint('thinking')

    try {
      const answer = await runAgentConversation(nextMessages)
      const reply = answer || '模型未返回内容，请稍后再试。'
      setAgentMessages((prev) => [...prev, { role: 'assistant', content: reply }])
      setAgentResult(reply)
    } catch (err) {
      console.error(err)
      setAgentError('AI 请求失败，请检查 Key、模型或网络环境。')
    } finally {
      setAgentLoading(false)
      setAgentStreamText('')
      setAgentStreamVisible(false)
    }
  }

  const handleQuickPrompt = (prompt) => {
    if (agentLoading) return
    handleAgentSend(prompt)
  }

  const handleClearChat = () => {
    if (agentLoading) return
    setAgentMessages([])
    setAgentResult('')
    setAgentError('')
    setAgentStreamText('')
    setAgentStreamVisible(false)
  }

  const fetchModels = async () => {
    if (!apiKey.trim()) return
    setModelsLoading(true)
    setModelsError('')
    try {
      const response = await fetch(
        'https://api.siliconflow.cn/v1/models?type=text&sub_type=chat',
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey.trim()}`
          }
        }
      )
      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || '获取模型列表失败')
      }
      const data = await response.json()
      const list = Array.isArray(data?.data)
        ? data.data.map((item) => item.id).filter(Boolean)
        : []

      const unique = Array.from(new Set(list))
      unique.sort()
      setModels(unique)

      if (unique.length && !unique.includes(model)) {
        const preferred = unique.find((name) => name.includes('Qwen')) || unique[0]
        setModel(preferred)
      }
    } catch (err) {
      console.error(err)
      setModelsError('模型列表获取失败，请检查 Key 或网络环境。')
      setModels([])
    } finally {
      setModelsLoading(false)
    }
  }

  return (
    <div className="app">
      {/* 
      <aside className="sidebar">
      </aside> 
      */}

      <main className="main">
        <header className="topbar">
          <div className="title-group">
            <h1 className="app-title">CUMT 成绩分析</h1>
            {fileName && <span className="subtitle">{fileName}</span>}
          </div>
          <div className="top-actions">
            <button className="ghost-btn" onClick={triggerFilePick}>
              导入表格
            </button>
            <button
              className="primary-btn"
              onClick={() => setShowExport(true)}
              disabled={!courses.length}
            >
              导出报告
            </button>
          </div>
        </header>

        <section className="stats-section">
          <div className="stat-card">
            <div className="stat-icon icon-gpa">🎓</div>
            <div className="stat-content">
              <p className="stat-label">加权绩点</p>
              <p className="stat-value">{formatNumber(stats.avgGpa)}</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon icon-score">💯</div>
            <div className="stat-content">
              <p className="stat-label">加权均分</p>
              <p className="stat-value">{formatNumber(stats.avgScore)}</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon icon-credit">📚</div>
            <div className="stat-content">
              <p className="stat-label">已修学分</p>
              <p className="stat-value">{formatNumber(totalCredits, 1)}</p>
              {useFilter && (
                <span className="stat-sub">
                  排除拓展：{formatNumber(creditsWithoutExpansion, 1)}
                </span>
              )}
            </div>
          </div>
        </section>

        {error && <div className="error-banner">{error}</div>}

        {!courses.length && (
          <section
            className={`empty-state ${isDragging ? 'empty-state-dragging' : ''}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <h2>导入成绩单</h2>
            <p>支持 .xlsx 格式，默认读取第一个工作表。</p>
            <p className="drag-tip">💡 可直接拖拽文件到此处</p>
            <button className="primary-btn" onClick={triggerFilePick}>
              选择文件
            </button>
          </section>
        )}

        {courses.length > 0 && (
          <>
            <section className="panel">
              <div className="panel-row">
                <div className="search-input-wrapper">
                  <input
                    className="search-input"
                    placeholder="🔍 搜索课程名称..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <div className="panel-actions">
                  <button className="ghost-btn" onClick={() => setShowRules(true)}>
                    ⚙️ 规则设置
                  </button>
                  <button className="ghost-btn" onClick={() => setShowHelp(true)}>
                    ？ 帮助
                  </button>
                </div>
              </div>

              <div className="panel-row">
                <div className="filter-group">
                  <span className="pill-label">排序:</span>
                  <div className="pill-group">
                    <Pill
                      active={sortDir === 'asc'}
                      onClick={() => setSortDir('asc')}
                    >
                      升序
                    </Pill>
                    <Pill
                      active={sortDir === 'desc'}
                      onClick={() => setSortDir('desc')}
                    >
                      降序
                    </Pill>
                  </div>
                  <div className="pill-group" style={{ marginLeft: '8px', borderLeft: '1px solid var(--border)', paddingLeft: '8px' }}>
                    {SORT_OPTIONS.map((option) => (
                      <Pill
                        key={option.id}
                        active={sortBy === option.id}
                        onClick={() => setSortBy(option.id)}
                      >
                        {option.label}
                      </Pill>
                    ))}
                  </div>
                </div>

                <div className="toggle-row">
                  <div className="toggle-item">
                    <span>加权筛选</span>
                    <Switch checked={useFilter} onChange={setUseFilter} />
                  </div>
                  <div className="toggle-item">
                    <span>加权倍率 (×1.2)</span>
                    <Switch checked={useMultiplier} onChange={setUseMultiplier} />
                  </div>
                </div>
                
                {importTime && <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-sub)' }}>导入于 {importTime.split(' ')[1]}</div>}
              </div>
            </section>

            <section className="chart-section">
              <div className="chart-card">
                <h3>成绩分布</h3>
                <div className="chart-wrapper">
                  <DistributionBar items={distribution} />
                </div>
              </div>
              <div className="chart-card">
                <h3>学期趋势</h3>
                <div className="chart-wrapper">
                  <TrendLine items={trend} />
                </div>
              </div>
            </section>

            <section className="course-list">
              {filteredCourses.map((course) => (
                <CourseCard
                  key={course.key}
                  course={course}
                  onSelect={() => setSelectedCourse(course)}
                />
              ))}
            </section>

            <section className="ai-panel" ref={aiRef}>
              <div className="ai-header">
                <div>
                  <h3>AI 智能体</h3>
                  <p>可调用工具回答问题：已修学分、低分课程、学期趋势等。</p>
                </div>
                <div className="ai-tool-tags">
                  <span>工具：学分统计</span>
                  <span>课程检索</span>
                  <span>学期汇总</span>
                  <span>高低分排行</span>
                  <span>目标均分计算</span>
                </div>
              </div>
              <div className="ai-layout-vertical">
                <div className="ai-output">
                  {agentMessages.length ? (
                    <div className="chat-list">
                      {agentMessages.map((message, index) => (
                        <div
                          key={`${message.role}-${index}`}
                          className={`chat-item ${message.role}`}
                        >
                          <div className="chat-role">
                            {message.role === 'user'
                              ? '你'
                              : message.role === 'tool'
                              ? '工具'
                              : 'AI'}
                          </div>
                          <div className="chat-bubble">
                            {message.role === 'assistant' ? (
                              renderAiText(message.content)
                            ) : message.role === 'tool' ? (
                              <div className="tool-card">
                                <div className="tool-title">
                                  {message.type === 'result' ? '工具结果' : '工具调用'} ·{' '}
                                  {message.tool}
                                </div>
                                <pre className="tool-json">
                                  {JSON.stringify(message.payload, null, 2)}
                                </pre>
                              </div>
                            ) : (
                              <p>{message.content}</p>
                            )}
                          </div>
                        </div>
                      ))}
                      {agentLoading && (
                        <div className="chat-item assistant">
                          <div className="chat-role">AI</div>
                          <div className="chat-bubble">
                            {agentStreamVisible && agentStreamText ? (
                              renderAiText(agentStreamText)
                            ) : (
                              <p>{agentStreamHint === 'tool' ? '正在调用工具...' : '正在思考...'}</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="ai-placeholder">
                      <div className="ai-icon">✨</div>
                      <p>输入问题或选择快捷提问，AI 将调用工具回答。</p>
                    </div>
                  )}
                </div>
                <div className="ai-controls">
                  <div className="ai-inputs-row">
                    <input
                      className="text-input"
                      type="password"
                      placeholder="SiliconFlow API Key"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                    />
                    {models.length ? (
                      <select
                          className="text-input model-select"
                          value={model}
                          onChange={(event) => setModel(event.target.value)}
                        >
                          {models.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                    ) : (
                      <input
                        className="text-input model-select"
                        placeholder={modelsLoading ? '获取模型中...' : '模型名（列表拉取失败可手动输入）'}
                        value={model}
                        onChange={(event) => setModel(event.target.value)}
                        disabled={!apiKey.trim()}
                      />
                    )}
                      <button
                        className="ghost-btn icon-only"
                        type="button"
                        onClick={fetchModels}
                        disabled={!apiKey.trim() || modelsLoading}
                        title="刷新模型列表"
                      >
                        ↻
                      </button>
                  </div>
                  <textarea
                    className="text-area ai-question"
                    placeholder="输入你的问题，例如：我修了多少学分？/ 列出低分课程"
                    rows={3}
                    value={agentInput}
                    onChange={(event) => setAgentInput(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                        handleAgentSend()
                      }
                    }}
                  />
                  <textarea
                    className="text-area ai-note"
                    placeholder="偏好或背景（可选），例如：想提升数学类课程 / 想规划考研与实习时间"
                    rows={2}
                    value={agentNote}
                    onChange={(event) => setAgentNote(event.target.value)}
                  />
                  <div className="ai-quick-row">
                    {AGENT_QUICK_PROMPTS.map((item) => (
                      <button
                        key={item.id}
                        className="chip-btn"
                        type="button"
                        onClick={() => handleQuickPrompt(item.prompt)}
                        disabled={agentLoading}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <div className="ai-actions">
                    <p className="ai-tip">
                       Key 仅保存在本地浏览器。
                       {!models.length && apiKey.trim() && (
                        <span className="text-danger"> 模型列表不可用时可手动输入。</span>
                       )}
                       {modelsError && <span className="text-danger"> {modelsError}</span>}
                       {agentError && <span className="text-danger"> {agentError}</span>}
                    </p>
                    <div className="ai-action-buttons">
                      <button
                        className="ghost-btn"
                        type="button"
                        onClick={handleClearChat}
                        disabled={agentLoading || !agentMessages.length}
                      >
                        清空对话
                      </button>
                      <button
                        className="primary-btn ai-btn"
                        onClick={() => handleAgentSend()}
                        disabled={agentLoading}
                      >
                        {agentLoading ? '正在思考...' : '发送'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFileChange}
        className="file-input"
      />

      <Modal open={showRules} title="特殊成绩设置" onClose={() => setShowRules(false)}>
        <div className="rule-tabs">
          {RULE_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`tab-btn ${ruleTab === tab.id ? 'active' : ''}`}
              onClick={() => setRuleTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="rule-tip">
          默认已根据关键字自动勾选：{MULTIPLIER_KEYWORDS.join('、')}
        </div>
        <input
          className="search-input"
          placeholder="搜索课程"
          value={ruleSearch}
          onChange={(event) => setRuleSearch(event.target.value)}
        />
        <div className="rule-list">
          {ruleList.map((course) => (
            <div key={course.key} className="rule-item">
              <div>
                <div className="rule-name">{course.name}</div>
                <div className="rule-meta">
                  {course.year} 学年 · 第{course.term}学期 · {course.credit}学分
                </div>
              </div>
              <Switch
                checked={Boolean(rules[ruleTab]?.[course.key])}
                onChange={() => toggleRule(ruleTab, course.key)}
              />
            </div>
          ))}
          {!ruleList.length && <p className="empty-tip">暂无课程</p>}
        </div>
      </Modal>

      <Modal open={showHelp} title="帮助" onClose={() => setShowHelp(false)}>
        <div className="help-block">
          <h3>加权筛选</h3>
          <p>仅统计推免计算范围内课程，自动排除拓展课程组。</p>
        </div>
        <div className="help-block">
          <h3>加权倍率</h3>
          <p>对公共课启用“分数 ×1.2”（可在特殊成绩设置中手动调整）。</p>
        </div>
        <div className="help-block">
          <h3>首次不及格</h3>
          <p>勾选后成绩按 60 计，绩点按 1.0 计。</p>
        </div>
      </Modal>

      <Modal open={showExport} title="导出报告" onClose={() => setShowExport(false)}>
        <div className="export-actions">
          <button
            className="primary-btn"
            onClick={() => handleExport('pdf')}
            disabled={exporting}
          >
            导出 PDF
          </button>
          <button
            className="ghost-btn"
            onClick={() => handleExport('png')}
            disabled={exporting}
          >
            导出 PNG
          </button>
        </div>
        <p className="export-tip">导出内容包含指标卡、图表与课程明细。</p>
      </Modal>

      <Modal
        open={Boolean(selectedCourse)}
        title="成绩详情"
        onClose={() => setSelectedCourse(null)}
      >
        {selectedCourse && (
          <div className="detail-panel">
            <div className="detail-header">
              <div>
                <h3>{selectedCourse.name}</h3>
                <p>
                  {selectedCourse.year} 学年 · 第{selectedCourse.term}学期 · 学分{' '}
                  {selectedCourse.credit}
                </p>
              </div>
              <div className="detail-tags">
                {selectedCourse.isMultiplier && <Tag color="primary">×1.2</Tag>}
                {selectedCourse.isFirstFail && <Tag color="warning">首次不及格</Tag>}
                {selectedCourse.isElective && <Tag color="muted">公选</Tag>}
                {selectedCourse.isExpansion && <Tag color="muted">拓展</Tag>}
              </div>
            </div>
            <div className="detail-metrics">
              <div>
                <span>原始总评</span>
                <strong>{formatScore(selectedCourse.totalScore)}</strong>
              </div>
              <div>
                <span>规则后总评</span>
                <strong>{formatScore(selectedCourse.effectiveScore)}</strong>
              </div>
              <div>
                <span>绩点</span>
                <strong>{formatNumber(selectedCourse.gpa)}</strong>
              </div>
            </div>
            <div className="detail-section">
              <h4>分项成绩</h4>
              {selectedCourse.parts?.length ? (
                <div className="detail-table">
                  <div className="detail-row detail-head">
                    <span>分项</span>
                    <span>分数</span>
                    <span>比例</span>
                  </div>
                  {selectedCourse.parts.map((part, index) => (
                    <div className="detail-row" key={`${part.name}-${index}`}>
                      <span>{part.name || '未命名'}</span>
                      <span>{formatScore(part.score)}</span>
                      <span>{formatPercent(part.weight)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="detail-empty">暂无分项数据（仅有总评或未提供分项）。</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      <section className="report" ref={reportRef} aria-hidden="true">
        <header className="report-header">
          <h2>成绩分析报告</h2>
          <span>{new Date().toLocaleDateString('zh-CN')}</span>
        </header>
        <div className="report-cards">
          <ReportCard label="加权绩点" value={formatNumber(stats.avgGpa)} />
          <ReportCard label="加权均分" value={formatNumber(stats.avgScore)} />
          <ReportCard label="总学分" value={formatNumber(totalCredits, 1)} />
        </div>
        <div className="report-section">
          <h3>成绩分布</h3>
          <div className="chart-wrapper report-chart">
            <DistributionBar items={distribution} />
          </div>
        </div>
        <div className="report-section">
          <h3>学期趋势</h3>
          <div className="chart-wrapper report-chart">
            <TrendLine items={trend} />
          </div>
        </div>
        <div className="report-section">
          <h3>课程明细</h3>
          <table className="report-table">
            <thead>
              <tr>
                <th>课程</th>
                <th>学分</th>
                <th>成绩</th>
                <th>绩点</th>
                <th>标记</th>
              </tr>
            </thead>
            <tbody>
              {analysisCourses.map((course) => (
                <tr key={course.key}>
                  <td>{course.name}</td>
                  <td>{course.credit}</td>
                  <td>{formatScore(course.effectiveScore)}</td>
                  <td>{formatNumber(course.gpa)}</td>
                  <td>
                    {course.isMultiplier && '×1.2'}
                    {course.isFirstFail && ' 首次不及格'}
                    {course.isElective && ' 公选课'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="report-section">
          <h3>AI 分析摘要</h3>
        <div className="ai-report">
            {agentResult ? renderAiText(agentResult) : <p>未生成 AI 分析。</p>}
          </div>
        </div>
      </section>
    </div>
  )
}

function CourseCard({ course, onSelect }) {
  const score = course.effectiveScore
  const gradeClass = getGradeColorClass(score)

  return (
    <div
      className="course-card"
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          onSelect?.()
        }
      }}
    >
      <div className={`score-badge ${gradeClass}`}>
        <span>{formatScore(score)}</span>
      </div>
      <div className="course-info">
        <div className="course-title">{course.name}</div>
        <div className="course-meta">
          学分：{course.credit} · 绩点：{formatNumber(course.gpa)}
        </div>
      </div>
      <div className="course-tags">
        {course.isMultiplier && <Tag color="primary">×1.2</Tag>}
        {course.isFirstFail && <Tag color="warning">首次不及格</Tag>}
        {course.isElective && <Tag color="muted">公选</Tag>}
        {course.isExpansion && <Tag color="muted">拓展</Tag>}
      </div>
    </div>
  )
}

function getGradeColorClass(score) {
  if (score === null || score === undefined) return ''
  const s = Number(score)
  if (s >= 90) return 'grade-s'
  if (s >= 80) return 'grade-a'
  if (s >= 70) return 'grade-b'
  if (s >= 60) return 'grade-c'
  return 'grade-d'
}

function Switch({ checked, onChange }) {
  return (
    <button
      className={`switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
      type="button"
      aria-pressed={checked}
    >
      <span className="switch-thumb" />
    </button>
  )
}

function Pill({ active, onClick, children }) {
  return (
    <button className={`pill ${active ? 'active' : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}

function Tag({ color, children }) {
  return <span className={`tag ${color}`}>{children}</span>
}

function Modal({ open, title, onClose, children }) {
  if (!open) return null
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

function ReportCard({ label, value }) {
  return (
    <div className="report-card">
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  )
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  return Number(value).toFixed(digits)
}

function formatScore(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  return Number(value).toFixed(1)
}

function renderAiText(text) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${Number(value * 100).toFixed(0)}%`
}

function buildAgentSystemPrompt({ tools, note, useFilter, useMultiplier }) {
  const toolLines = tools
    .map((tool) => {
      const params = tool.parameters && Object.keys(tool.parameters).length
        ? JSON.stringify(tool.parameters, null, 2)
        : '无'
      return `工具: ${tool.name}\n说明: ${tool.description}\n参数: ${params}`
    })
    .join('\n\n')

  const toolSchema = JSON.stringify(
    {
      tool: '工具名',
      arguments: {
        key: 'value'
      }
    },
    null,
    2
  )

  return `你是一个成绩分析智能体，必须使用中文回答。\n当前开关：加权筛选=${useFilter ? '开启' : '关闭'}，加权倍率=${useMultiplier ? '开启' : '关闭'}。\n${note ? `用户补充：${note}` : '用户补充：无'}\n\n可用工具：\n${toolLines}\n\n工具调用规则：\n- 需要工具时，只输出一行 JSON，且必须符合以下结构：\n${toolSchema}\n- 不需要工具时，直接输出完整回答，不要输出 JSON\n- 工具结果可信，优先基于工具结果回答\n- 如缺少关键参数，请先向用户追问\n- 避免重复调用同一工具；若信息已足够，请直接给结论\n`
}
