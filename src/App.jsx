import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { readWorkbook, workbookToRows } from './utils/excel'
import {
  aggregateCourses,
  applyCourseRules,
  buildDefaultMultiplier,
  buildDistribution,
  buildTermTrend,
  computeStats,
  toRuleSet
} from './utils/grade'
import { exportReport } from './utils/export'
import { MULTIPLIER_KEYWORDS } from './utils/constants'
import { DistributionBar, TrendLine } from './components/Charts'

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
  const [aiNote, setAiNote] = useState('')
  const [aiResult, setAiResult] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
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

  const handleAiAnalyze = async () => {
    setAiError('')
    if (!apiKey.trim()) {
      setAiError('请先填写 SiliconFlow API Key')
      return
    }
    if (!model) {
      setAiError('请先获取并选择模型')
      return
    }
    if (!courses.length) {
      setAiError('请先导入成绩数据')
      return
    }

    setAiLoading(true)
    setAiResult('') // Clear previous result
    try {
      const prompt = buildAiPrompt({
        stats,
        courses: analysisCourses,
        distribution,
        trend,
        useFilter,
        useMultiplier,
        note: aiNote
      })

      const response = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                '你是专业的学业导师与学习规划师，需要用简洁清晰的中文输出成绩诊断、学习计划、时间管理与职业规划建议。'
            },
            { role: 'user', content: prompt }
          ],
          stream: true,
          max_tokens: 1200,
          temperature: 0.7
        })
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || '请求失败')
      }

      const contentType = response.headers.get('content-type') || ''
      if (!response.body || !contentType.includes('text/event-stream')) {
        const raw = await response.text()
        let data
        try {
          data = JSON.parse(raw)
        } catch (e) {
          throw new Error(raw || '解析模型响应失败')
        }
        const content = data?.choices?.[0]?.message?.content || ''
        setAiResult(content.trim() || '模型未返回内容，请稍后再试。')
        return
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
              setAiResult(resultText)
            }
          } catch (e) {
            // 可能是被拆开的 JSON，放回缓冲区等待下一段
            if (line.startsWith('{') && !line.endsWith('}')) {
              buffer = line + '\n' + buffer
            }
          }
        }
      }
    } catch (err) {
      console.error(err)
      setAiError('AI 请求失败，请检查 Key、模型或网络环境。')
    } finally {
      setAiLoading(false)
    }
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
                  <h3>AI 智能分析</h3>
                  <p>基于当前筛选与倍率设置生成诊断、学习规划与职业建议。</p>
                </div>
              </div>
              <div className="ai-layout-vertical">
                <div className="ai-output">
                  {aiResult ? (
                    renderAiText(aiResult)
                  ) : (
                    <div className="ai-placeholder">
                      <div className="ai-icon">✨</div>
                      <p>点击下方按钮，开始智能分析您的成绩单</p>
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
                      className="text-area"
                      placeholder="额外说明（可选），例如：想提升数学类课程 / 想规划考研与实习时间"
                      rows={2}
                      value={aiNote}
                      onChange={(event) => setAiNote(event.target.value)}
                    />
                  <div className="ai-actions">
                    <p className="ai-tip">
                       Key 仅保存在本地浏览器。
                       {!models.length && apiKey.trim() && (
                        <span className="text-danger"> 模型列表不可用时可手动输入。</span>
                       )}
                       {modelsError && <span className="text-danger"> {modelsError}</span>}
                       {aiError && <span className="text-danger"> {aiError}</span>}
                    </p>
                    <button
                      className="primary-btn ai-btn"
                      onClick={handleAiAnalyze}
                      disabled={aiLoading}
                    >
                      {aiLoading ? '正在思考...' : '✨ 开始分析'}
                    </button>
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
          <ReportCard label="总学分" value={formatNumber(stats.totalCredits, 1)} />
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
            {aiResult ? renderAiText(aiResult) : <p>未生成 AI 分析。</p>}
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
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  )
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${Number(value * 100).toFixed(0)}%`
}

function buildAiPrompt({ stats, courses, distribution, trend, useFilter, useMultiplier, note }) {
  const scored = courses.filter((course) => course.effectiveScore !== null)
  const topCourses = [...scored]
    .sort((a, b) => b.effectiveScore - a.effectiveScore)
    .slice(0, 5)
    .map((course) => ({
      课程: course.name,
      成绩: round(course.effectiveScore),
      学分: course.credit
    }))
  const bottomCourses = [...scored]
    .sort((a, b) => a.effectiveScore - b.effectiveScore)
    .slice(0, 5)
    .map((course) => ({
      课程: course.name,
      成绩: round(course.effectiveScore),
      学分: course.credit
    }))

  const summary = {
    规则说明: {
      加权筛选: useFilter ? '已开启（排除拓展课程组）' : '未开启',
      加权倍率: useMultiplier ? '已开启（分数×1.2）' : '未开启',
      首次不及格: '勾选课程按60分计',
      公选课: '平均分按10学分参与推免加权'
    },
    关键指标: {
      课程数: scored.length,
      加权均分: round(stats.avgScore),
      加权绩点: round(stats.avgGpa),
      总学分: round(stats.totalCredits, 1)
    },
    成绩分布: distribution,
    学期趋势: trend.map((item) => ({ 学期: item.term, 平均分: round(item.avg) })),
    高分课程: topCourses,
    低分课程: bottomCourses
  }

  return `请基于以下成绩摘要进行分析，并按【成绩诊断】【学习规划】【时间管理】【职业规划建议】【风险提醒】输出。\n\n成绩摘要：\n${JSON.stringify(
    summary,
    null,
    2
  )}\n\n额外说明：${note ? note : '无'}`
}

function round(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return 0
  return Number(value.toFixed(digits))
}
