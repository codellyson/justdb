import { hoverTooltip } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@uiw/react-codemirror';
import { explainSqlToken } from './smart-query';

export function getSqlHover(state: EditorState, position: number, side: -1 | 1) {
  const node = syntaxTree(state).resolveInner(position, side);
  if (position < node.from || position > node.to) return null;
  const token = state.sliceDoc(node.from, node.to);
  const isFunction = ['Builtin', 'Identifier', 'Keyword'].includes(node.name) &&
    /^\s*\(/.test(state.sliceDoc(node.to, Math.min(state.doc.length, node.to + 64)));
  if (node.name !== 'Keyword' && !isFunction) return null;
  const explanation = (isFunction ? explainSqlToken(token, true) : null) ??
    (node.name === 'Keyword' ? explainSqlToken(token) : null);
  return explanation ? { ...explanation, from: node.from, to: node.to } : null;
}

export const statementHover = hoverTooltip((view, position, side) => {
  const explanation = getSqlHover(view.state, position, side);
  if (!explanation) return null;
  return {
    pos: explanation.from,
    end: explanation.to,
    above: true,
    create() {
      const dom = document.createElement('div');
      dom.className = 'sql-statement-help';
      const heading = document.createElement('strong');
      heading.textContent = explanation.title;
      const body = document.createElement('p');
      body.textContent = explanation.description;
      const note = document.createElement('small');
      note.textContent = 'Syntax guide · No query executed';
      dom.append(heading, body, note);
      return { dom };
    },
  };
}, { hoverTime: 450 });
