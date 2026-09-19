import { useState, type ComponentProps } from 'react'
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './markdown.css'

function CodeBlock({ children, node }: ComponentProps<'pre'> & ExtraProps) {
  const codeNode = node?.children.find(child => child.type === 'element' && child.tagName === 'code')
  const code = codeNode?.type === 'element'
    ? codeNode.children.map(child => child.type === 'text' ? child.value : '').join('')
    : ''
  const classes = codeNode?.type === 'element' ? codeNode.properties.className : undefined
  const languageClass = Array.isArray(classes)
    ? classes.find(value => typeof value === 'string' && value.startsWith('language-'))
    : undefined
  const language = typeof languageClass === 'string' ? languageClass.slice('language-'.length) : '代码'
  const [copy, setCopy] = useState<{ code: string; status: 'pending' | 'success' | 'error' } | null>(null)
  const status = copy?.code === code ? copy.status : undefined

  async function copyCode() {
    setCopy({ code, status: 'pending' })
    try {
      await navigator.clipboard.writeText(code)
      setCopy({ code, status: 'success' })
    } catch {
      setCopy({ code, status: 'error' })
    }
  }

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-toolbar">
        <span>{language}</span>
        <button type="button" onClick={copyCode} disabled={status === 'pending'} aria-label="复制代码">
          {status === 'pending' ? '复制中' : status === 'success' ? '已复制' : '复制代码'}
        </button>
        <span role="status" className={status === 'error' ? 'markdown-copy-error' : undefined}>
          {status === 'error' ? '复制失败，请手动选择代码复制' : status === 'success' ? '代码已复制' : ''}
        </span>
      </div>
      <pre tabIndex={0} aria-label={`${language}代码，可横向滚动`}>{children}</pre>
    </div>
  )
}

function MarkdownTable({ children }: ComponentProps<'table'> & ExtraProps) {
  return <div className="markdown-table-scroll" tabIndex={0} role="region" aria-label="表格，可横向滚动"><table>{children}</table></div>
}

function MarkdownLink({ href, title, children }: ComponentProps<'a'> & ExtraProps) {
  return <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>
}

function MarkdownImage({ src, alt, title }: ComponentProps<'img'> & ExtraProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const source = typeof src === 'string' ? src : ''
  if (!/^https?:\/\//i.test(source) || failedSource === source) {
    return <span className="markdown-image-fallback">{alt || '图片无法显示'}</span>
  }
  return <img src={source} alt={alt || '图片'} title={title} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedSource(source)} />
}

function TaskCheckbox({ checked }: ComponentProps<'input'> & ExtraProps) {
  return <input type="checkbox" checked={Boolean(checked)} readOnly disabled aria-label={checked ? '已完成任务' : '未完成任务'} />
}

// Keep component identities stable while the Markdown source streams in.
const components: Components = {
  pre: CodeBlock,
  table: MarkdownTable,
  a: MarkdownLink,
  img: MarkdownImage,
  input: TaskCheckbox,
}
const remarkPlugins = [remarkGfm]

export function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="markdown-message">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components} skipHtml>{text}</ReactMarkdown>
    </div>
  )
}
