'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check, ExternalLink, AlertCircle, Info, AlertTriangle, BookOpen, Layers, Code2, LifeBuoy, FileText } from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CodeTabs } from './code-tabs';
import { TryIt } from './try-it';
import { applyBrandingToTryItConfig } from '@/lib/platformBranding';

function CodeBlock({ children, className, inline }: any) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  let language = (match ? match[1] : '').toLowerCase();

  // Normalize some common aliases
  const aliasMap: Record<string, string> = {
    sh: 'bash',
    shell: 'bash',
    js: 'javascript',
    ts: 'typescript',
    http: 'markup', // fallback for http examples
    text: 'markup',
  };
  language = aliasMap[language] || language || 'markup';

  const handleCopy = () => {
    navigator.clipboard.writeText(String(children));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Render interactive TryIt blocks for fenced code with language "tryit"
  if (!inline && language === 'tryit') {
    try {
      const raw = JSON.parse(String(children));
      const cfg = applyBrandingToTryItConfig(raw, '');
      return <TryIt config={cfg} />;
    } catch {
      return (
        <div className="my-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600">
          Invalid TryIt config JSON. Ensure the fenced block contains valid JSON.
        </div>
      );
    }
  }

  if (inline) {
    return (
      <code className="px-1.5 py-0.5 rounded bg-muted text-sm font-mono text-foreground border border-border">
        {children}
      </code>
    );
  }

  const code = String(children).replace(/\n$/, '');

  return (
    <div className="relative my-4">
      <span className="absolute left-3 top-3 text-xs uppercase tracking-wide text-muted-foreground">{language}</span>
      <pre
        className="group bg-muted text-foreground rounded-lg border border-border"
        style={{
          margin: 0,
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          padding: '1rem',
          paddingRight: '3rem',
          paddingTop: '2.5rem',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <button
          onClick={handleCopy}
          className="absolute right-2 top-2 p-2 rounded-lg bg-background/80 backdrop-blur-sm border border-border hover:bg-muted transition-colors"
          title="Copy code"
        >
          {copied ? (
            <Check className="w-4 h-4 text-green-500" />
          ) : (
            <Copy className="w-4 h-4 text-muted-foreground" />
          )}
        </button>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function CustomLink({ href, children }: any) {
  const pathname = usePathname();
  const isExternal = href?.startsWith('http');
  const isAnchor = href?.startsWith('#');
  const isApi = href?.startsWith('/api/');

  if (href === '/api/docs/download-skill') {
    return (
      <a
        href={href}
        className="inline-flex items-center gap-2 px-5 py-2.5 my-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-all shadow-[0_0_15px_rgba(99,102,241,0.4)] hover:shadow-[0_0_20px_rgba(99,102,241,0.6)] no-underline active:scale-95 duration-200"
        download
      >
        {children}
      </a>
    );
  }

  if (isApi) {
    return (
      <a href={href} className="text-primary hover:underline font-semibold" download>
        {children}
      </a>
    );
  }

  if (isAnchor) {
    return (
      <a
        href={href}
        className="text-primary hover:underline font-medium"
        onClick={(e) => {
          e.preventDefault();
          document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' });
        }}
      >
        {children}
      </a>
    );
  }

  if (isExternal) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline font-medium inline-flex items-center gap-1"
      >
        {children}
        <ExternalLink className="w-3 h-3" />
      </a>
    );
  }

  // Normalize internal doc links
  let normalizedHref = href;

  // Handle relative paths within docs
  if (href && (href.startsWith('./') || href.startsWith('../'))) {
    // Extract current doc path (everything after /developers/docs/)
    const docsPrefix = '/developers/docs/';
    const currentDocPath = pathname?.startsWith(docsPrefix)
      ? pathname.slice(docsPrefix.length)
      : '';

    // Handle ../public/ paths - rewrite to root
    if (href.includes('/public/')) {
      const publicIndex = href.indexOf('/public/');
      normalizedHref = href.slice(publicIndex + 7); // Remove '/public' prefix, keeping the /
      if (!normalizedHref.startsWith('/')) {
        normalizedHref = '/' + normalizedHref;
      }
    } else {
      // Build the path array for resolution
      // Current path represents a file, so we need its directory
      const currentParts = currentDocPath ? currentDocPath.split('/').filter(Boolean) : [];
      // Remove the last part (filename) to get the directory
      if (currentParts.length > 0) {
        currentParts.pop();
      }

      // Split href and filter out empty strings and dots
      const hrefParts = href.split('/').filter((part: string) => part && part !== '.');

      // Resolve relative path
      const resolvedParts = [...currentParts];
      for (const part of hrefParts) {
        if (part === '..') {
          resolvedParts.pop();
        } else {
          resolvedParts.push(part);
        }
      }

      normalizedHref = docsPrefix + resolvedParts.join('/');
    }
  }

  // Strip .md extension
  if (normalizedHref?.endsWith('.md')) {
    normalizedHref = normalizedHref.slice(0, -3);
  }

  // Remove trailing /README
  if (normalizedHref?.endsWith('/README')) {
    normalizedHref = normalizedHref.slice(0, -7);
  }

  return (
    <Link href={normalizedHref} className="text-primary hover:underline font-medium">
      {children}
    </Link>
  );
}

function Heading({ level, children, ...props }: any) {
  function extractText(node: any): string {
    try {
      if (typeof node === 'string') return node;
      if (Array.isArray(node)) return node.map(extractText).join('');
      if (node && node.props && node.props.children) return extractText(node.props.children);
    } catch { }
    return String(node ?? '').toString();
  }

  const titleText = extractText(children).trim();
  const id = titleText.toLowerCase().replace(/[^\w]+/g, '-');
  const HeadingTag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

  const classNames: Record<number, string> = {
    1: 'text-4xl font-bold mb-6 mt-8 pb-2 border-b border-border',
    2: 'text-2xl font-bold mt-12 mb-4 pb-2 border-b border-border',
    3: 'text-xl font-semibold mt-8 mb-3',
    4: 'text-lg font-semibold mt-6 mb-2',
    5: 'text-base font-semibold mt-4 mb-2',
    6: 'text-sm font-semibold mt-4 mb-2',
  };

  const t = titleText.toLowerCase();
  let IconComp: any = null;
  if (t.includes('quick links')) IconComp = BookOpen;
  else if (t.includes('core concepts')) IconComp = Layers;
  else if (t.includes('quick example')) IconComp = Code2;
  else if (t.includes('support')) IconComp = LifeBuoy;
  else if (t.includes('license')) IconComp = FileText;

  return (
    <HeadingTag id={id} className={`${classNames[level]} scroll-mt-28 group`} {...props}>
      <span className="inline-flex items-center gap-2">
        {IconComp ? <IconComp className="w-5 h-5 text-muted-foreground" /> : null}
        <a href={`#${id}`} className="no-underline hover:underline decoration-dotted underline-offset-4">
          {children}
        </a>
      </span>
      <a href={`#${id}`} className="ml-2 opacity-0 group-hover:opacity-100 text-muted-foreground">#</a>
    </HeadingTag>
  );
}

function Blockquote({ children }: any) {
  // Check if it's a special callout
  const text = children?.toString() || '';
  let type: 'info' | 'warning' | 'error' | 'note' = 'note';
  let icon = <Info className="w-5 h-5" />;
  let bgColor = 'bg-blue-500/10 border-blue-500/50';
  let iconColor = 'text-blue-500';

  if (text.toLowerCase().includes('warning') || text.toLowerCase().includes('caution')) {
    type = 'warning';
    icon = <AlertTriangle className="w-5 h-5" />;
    bgColor = 'bg-yellow-500/10 border-yellow-500/50';
    iconColor = 'text-yellow-500';
  } else if (text.toLowerCase().includes('error') || text.toLowerCase().includes('danger')) {
    type = 'error';
    icon = <AlertCircle className="w-5 h-5" />;
    bgColor = 'bg-red-500/10 border-red-500/50';
    iconColor = 'text-red-500';
  }

  return (
    <div className={`my-4 rounded-lg border ${bgColor}`}>
      <div className="flex items-start gap-3 p-4">
        <div className={iconColor}>{icon}</div>
        <div className="flex-1 text-sm leading-6">{children}</div>
      </div>
    </div>
  );
}

function Table({ children }: any) {
  return (
    <div className="my-6 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm table-fixed">{children}</table>
    </div>
  );
}

function TableHead({ children }: any) {
  return <thead className="bg-muted/50 sticky top-0 backdrop-blur">{children}</thead>;
}

function TableRow({ children }: any) {
  return <tr className="border-b border-border last:border-0 hover:bg-muted/30">{children}</tr>;
}

function TableCell({ children, isHeader }: any) {
  if (isHeader) {
    return (
      <th className="px-4 py-3 text-left font-semibold text-foreground">
        {children}
      </th>
    );
  }
  return <td className="px-4 py-3 text-foreground align-top">{children}</td>;
}

export function MarkdownRenderer({ content }: { content: string }) {
  // Extract code tabs and replace with placeholders
  const codeTabsMap = new Map<string, { label: string; language: string; code: string }[]>();
  let tabCounter = 0;

  const processedContent = content.replace(
    /<!-- CODE_TABS_START -->\s*([\s\S]*?)\s*<!-- CODE_TABS_END -->/g,
    (match, tabsContent) => {
      const tabs: { label: string; language: string; code: string }[] = [];
      const tabPattern = /<!-- TAB:([^\s]+) -->\s*```(\w+)\s*([\s\S]*?)```/g;
      let tabMatch;

      while ((tabMatch = tabPattern.exec(tabsContent)) !== null) {
        tabs.push({
          label: tabMatch[1],
          language: tabMatch[2],
          code: tabMatch[3].trim(),
        });
      }

      if (tabs.length > 0) {
        const id = `CODE_TABS_${tabCounter++}`;
        codeTabsMap.set(id, tabs);
        return `\n\n__${id}__\n\n`;
      }
      return match;
    }
  );

  // Render content with code tabs
  const parts = processedContent.split(/(__CODE_TABS_\d+__)/);

  return (
    <>
      {parts.map((part, index) => {
        const match = part.match(/^__CODE_TABS_(\d+)__$/);
        if (match) {
          const tabs = codeTabsMap.get(part.replace(/__/g, ''));
          return tabs ? <CodeTabs key={index} tabs={tabs} /> : null;
        }

        return (
          <ReactMarkdown
            key={index}
            remarkPlugins={[remarkGfm]}
            components={{
              code: CodeBlock,
              a: CustomLink,
              h1: (props) => <Heading level={1} {...props} />,
              h2: (props) => <Heading level={2} {...props} />,
              h3: (props) => <Heading level={3} {...props} />,
              h4: (props) => <Heading level={4} {...props} />,
              h5: (props) => <Heading level={5} {...props} />,
              h6: (props) => <Heading level={6} {...props} />,
              blockquote: Blockquote,
              table: Table,
              thead: TableHead,
              tr: TableRow,
              th: (props) => <TableCell isHeader {...props} />,
              td: TableCell,
              p: ({ children }) => {
                // Check if paragraph contains a code block (non-inline code)
                const hasCodeBlock = React.Children.toArray(children).some((child: any) => {
                  // Check if it's a code element that will render as a block (has className with language-)
                  return (
                    child?.type === CodeBlock ||
                    (child?.props?.className &&
                      typeof child.props.className === 'string' &&
                      child.props.className.includes('language-') &&
                      !child.props.inline)
                  );
                });
                const Tag: any = hasCodeBlock ? 'div' : 'p';
                return <Tag className="mb-4 leading-7 text-foreground">{children}</Tag>;
              },
              ul: ({ children }) => <ul className="list-disc list-outside pl-6 mb-4 space-y-2 text-foreground">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal list-outside pl-6 mb-4 space-y-2 text-foreground">{children}</ol>,
              li: ({ children }) => <li className="ml-4 space-y-2 leading-7">{children}</li>,
              hr: () => <hr className="my-8 border-border" />,
              strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
              em: ({ children }) => <em className="italic">{children}</em>,
            }}
          >
            {part}
          </ReactMarkdown>
        );
      })}
    </>
  );
}
