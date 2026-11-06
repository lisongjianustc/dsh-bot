/**
 * A small, dependency-free Markdown renderer for Bot messages.
 *
 * Bot replies are model-generated Markdown, and the workbench has no Markdown
 * library in the shell's module table. This module parses the subset the bots
 * actually emit — paragraphs, line breaks, bold/italic/strikethrough, inline
 * code, fenced code blocks, ordered and unordered lists, headings, block
 * quotes, horizontal rules and links — straight into React elements.
 *
 * Safety: raw HTML is never parsed or injected. Text always becomes a React
 * text node (React escapes it), and a link is only rendered when its target is
 * an http(s) or mailto URL; everything else stays plain text. There is no
 * `dangerouslySetInnerHTML` anywhere in this module.
 */

'use strict'

var React = require('react')
var h = React.createElement

/** Normalize line endings and coerce to a string. */
function normalize(text) {
  return String(text === undefined || text === null ? '' : text).replace(/\r\n?/g, '\n')
}

/** Only these protocols may become real links. */
function safeUrl(url) {
  var value = String(url === undefined || url === null ? '' : url).trim()
  if (value === '') return ''
  if (/^https?:\/\/[^\s]+$/i.test(value)) return value
  if (/^mailto:[^\s]+$/i.test(value)) return value
  return ''
}

/** Whether a line starts a new block (so a paragraph must stop there). */
function isBlockStart(line) {
  var value = String(line)
  if (/^\s*(```+|~~~+)/.test(value)) return true
  if (/^\s{0,3}#{1,6}\s+/.test(value)) return true
  if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(value)) return true
  if (/^\s{0,3}>\s?/.test(value)) return true
  if (/^\s{0,3}(?:[-*+]|\d+[.)])\s+/.test(value)) return true
  return false
}

/** Parse one line of inline Markdown into React nodes. */
function inlineNodes(text, keyPrefix) {
  var source = String(text === undefined || text === null ? '' : text)
  var nodes = []
  var buffer = ''
  var index = 0
  var prefix = keyPrefix === undefined ? 'i' : keyPrefix

  function flush() {
    if (buffer !== '') {
      nodes.push(buffer)
      buffer = ''
    }
  }

  function push(element) {
    flush()
    nodes.push(element)
  }

  while (index < source.length) {
    var rest = source.slice(index)
    var char = source.charAt(index)

    // Inline code first: no formatting applies inside it.
    if (char === '`') {
      var codeEnd = source.indexOf('`', index + 1)
      if (codeEnd > index + 1) {
        push(
          h(
            'code',
            { key: prefix + '-code-' + index, className: 'db-md-code-inline' },
            source.slice(index + 1, codeEnd),
          ),
        )
        index = codeEnd + 1
        continue
      }
    }

    // Bold **text** / __text__ (delimiters must hug non-space text)
    if (rest.slice(0, 2) === '**' || rest.slice(0, 2) === '__') {
      var boldMark = rest.slice(0, 2)
      var boldEnd = source.indexOf(boldMark, index + 2)
      var afterOpen = source.charAt(index + 2)
      var beforeClose = boldEnd > index + 2 ? source.charAt(boldEnd - 1) : ''
      if (boldEnd > index + 2 && /\S/.test(afterOpen) && /\S/.test(beforeClose)) {
        push(
          h(
            'strong',
            { key: prefix + '-b-' + index },
            inlineNodes(source.slice(index + 2, boldEnd), prefix + '-b' + index),
          ),
        )
        index = boldEnd + 2
        continue
      }
    }

    // Strikethrough ~~text~~
    if (rest.slice(0, 2) === '~~') {
      var strikeEnd = source.indexOf('~~', index + 2)
      if (strikeEnd > index + 2) {
        push(
          h(
            'del',
            { key: prefix + '-d-' + index },
            inlineNodes(source.slice(index + 2, strikeEnd), prefix + '-d' + index),
          ),
        )
        index = strikeEnd + 2
        continue
      }
    }

    // Italic *text* / _text_ (a single marker, not part of a word)
    if (char === '*' || char === '_') {
      var previous = index === 0 ? '' : source.charAt(index - 1)
      var wordBoundary = char === '_' ? !/[A-Za-z0-9]/.test(previous) : true
      var doubleNext = source.charAt(index + 1) === char
      var afterEm = source.charAt(index + 1)
      if (wordBoundary && !doubleNext && /\S/.test(afterEm)) {
        var italicEnd = source.indexOf(char, index + 1)
        var beforeEmClose = italicEnd > index + 1 ? source.charAt(italicEnd - 1) : ''
        if (italicEnd > index + 1 && /\S/.test(beforeEmClose)) {
          push(
            h(
              'em',
              { key: prefix + '-em-' + index },
              inlineNodes(source.slice(index + 1, italicEnd), prefix + '-em' + index),
            ),
          )
          index = italicEnd + 1
          continue
        }
      }
    }

    // Link [label](url)
    if (char === '[') {
      var labelEnd = source.indexOf(']', index + 1)
      if (labelEnd > index + 1 && source.charAt(labelEnd + 1) === '(') {
        var urlEnd = source.indexOf(')', labelEnd + 2)
        if (urlEnd > labelEnd + 2) {
          var label = source.slice(index + 1, labelEnd)
          var href = safeUrl(source.slice(labelEnd + 2, urlEnd))
          if (href !== '') {
            push(
              h(
                'a',
                {
                  key: prefix + '-a-' + index,
                  className: 'db-md-link',
                  href: href,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                },
                inlineNodes(label, prefix + '-al' + index),
              ),
            )
            index = urlEnd + 1
            continue
          }
        }
      }
    }

    // Bare http(s) URL -> link (models often paste them unwrapped).
    if (rest.slice(0, 4) === 'http') {
      var urlMatch = /^https?:\/\/[^\s<>()]+/.exec(rest)
      if (urlMatch !== null) {
        // Trailing sentence punctuation belongs to the sentence, not the URL.
        var linked = urlMatch[0].replace(/[.,;:!?\]}]+$/, '')
        if (linked !== '') {
          push(
            h(
              'a',
              {
                key: prefix + '-u-' + index,
                className: 'db-md-link',
                href: linked,
                target: '_blank',
                rel: 'noopener noreferrer',
              },
              linked,
            ),
          )
          index += linked.length
          continue
        }
      }
    }

    buffer += char
    index += 1
  }
  flush()
  return nodes
}

/** Append the streaming cursor to the deepest trailing inline container. */
function appendCursor(element, cursorClass) {
  if (!React.isValidElement(element)) return element
  var cursor = h('span', { className: cursorClass, 'aria-hidden': 'true' })
  if (element.type === 'pre' || element.type === 'hr') return element
  var children = React.Children.toArray(element.props.children)
  var lastChild = children.length > 0 ? children[children.length - 1] : undefined
  if (lastChild !== undefined && React.isValidElement(lastChild) && lastChild.type === 'li') {
    children[children.length - 1] = appendCursor(lastChild, cursorClass)
  } else {
    children.push(cursor)
  }
  return React.cloneElement(element, { key: element.key }, children)
}

/**
 * Render Markdown text to an array of React elements.
 * @param text Markdown source.
 * @param cursorClass when set, a streaming cursor span is appended to the last block.
 * @returns array of React elements (empty for blank input).
 */
function render(text, cursorClass) {
  var source = normalize(text)
  var lines = source.split('\n')
  var blocks = []
  var index = 0
  var key = 0

  function nextKey(name) {
    key += 1
    return name + '-' + key
  }

  while (index < lines.length) {
    var line = lines[index]
    if (line.trim() === '') {
      index += 1
      continue
    }

    // Fenced code block
    var fence = /^\s*(```+|~~~+)\s*([A-Za-z0-9+#._-]*)\s*$/.exec(line)
    if (fence !== null) {
      var marker = fence[1]
      var language = fence[2]
      var code = []
      index += 1
      while (index < lines.length) {
        var closing = /^\s*(```+|~~~+)\s*$/.exec(lines[index])
        if (closing !== null && closing[1].charAt(0) === marker.charAt(0) && closing[1].length >= marker.length) {
          index += 1
          break
        }
        code.push(lines[index])
        index += 1
      }
      blocks.push(
        h(
          'pre',
          { key: nextKey('pre'), className: 'db-md-pre' },
          language === '' ? null : h('span', { className: 'db-md-lang' }, language),
          h('code', null, code.join('\n')),
        ),
      )
      continue
    }

    // Heading
    var heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      var level = heading[1].length
      blocks.push(
        h(
          'div',
          { key: nextKey('h'), className: 'db-md-h db-md-h' + level },
          inlineNodes(heading[2].replace(/\s+#+\s*$/, ''), 'h' + level),
        ),
      )
      index += 1
      continue
    }

    // Horizontal rule
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push(h('hr', { key: nextKey('hr'), className: 'db-md-hr' }))
      index += 1
      continue
    }

    // Block quote
    if (/^\s{0,3}>\s?/.test(line)) {
      var quoted = []
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s{0,3}>\s?/, ''))
        index += 1
      }
      blocks.push(
        h('blockquote', { key: nextKey('q'), className: 'db-md-quote' }, inlineNodes(quoted.join('\n'), 'q')),
      )
      continue
    }

    // List (unordered or ordered); continuation lines stay in the item
    var unordered = /^\s{0,3}[-*+]\s+/.test(line)
    var ordered = /^\s{0,3}\d+[.)]\s+/.test(line)
    if (unordered || ordered) {
      var items = []
      while (index < lines.length) {
        var itemMatch = ordered ? /^\s{0,3}\d+[.)]\s+/.exec(lines[index]) : /^\s{0,3}[-*+]\s+/.exec(lines[index])
        if (itemMatch === null) break
        var content = lines[index].slice(itemMatch[0].length)
        index += 1
        var continuation = []
        while (index < lines.length && lines[index].trim() !== '' && /^\s{2,}/.test(lines[index]) && !isBlockStart(lines[index].trim())) {
          continuation.push(lines[index].trim())
          index += 1
        }
        var itemText = continuation.length === 0 ? content : content + '\n' + continuation.join('\n')
        items.push(h('li', { key: 'li-' + items.length, className: 'db-md-li' }, inlineNodes(itemText, 'li' + items.length)))
      }
      blocks.push(
        h(
          ordered ? 'ol' : 'ul',
          { key: nextKey('list'), className: ordered ? 'db-md-ol' : 'db-md-ul' },
          items,
        ),
      )
      continue
    }

    // Paragraph: consecutive non-blank lines up to the next block
    var paragraph = [line]
    index += 1
    while (index < lines.length && lines[index].trim() !== '' && !isBlockStart(lines[index])) {
      paragraph.push(lines[index])
      index += 1
    }
    blocks.push(h('p', { key: nextKey('p'), className: 'db-md-p' }, inlineNodes(paragraph.join('\n'), 'p')))
  }

  if (cursorClass !== undefined && cursorClass !== null && blocks.length > 0) {
    var last = blocks.length - 1
    var cursor = appendCursor(blocks[last], cursorClass)
    if (cursor !== blocks[last]) blocks[last] = cursor
    else blocks.push(h('span', { key: 'cursor', className: cursorClass, 'aria-hidden': 'true' }))
  }
  return blocks
}

module.exports = { render: render, inlineNodes: inlineNodes }
