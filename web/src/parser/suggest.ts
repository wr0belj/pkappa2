import nearley from "nearley";
import grammar, {
  ExpressionQueryElement,
  QueryElement,
  isExpression,
  isLogicExpression,
  isSubExpression,
} from "./query";
import { ConverterStatistics, TagInfo } from "@/apiClient";

type SuggestionResults = {
  suggestions: string[];
  start: number;
  end: number;
  type: string;
};

const queryGrammar = nearley.Grammar.fromCompiled(grammar);

const ALL_KEYWORDS = [
  "id",
  "tag",
  "service",
  "mark",
  "generated",
  "protocol",
  "ftime",
  "ltime",
  "time",
  "cdata",
  "sdata",
  "data",
  "cport",
  "sport",
  "port",
  "chost",
  "shost",
  "host",
  "cbytes",
  "sbytes",
  "bytes",
  "sort",
  "limit",
  "group",
];

const OPERATORS = ["and", "or", "then"];

const PROTOCOL_VALUES = ["tcp", "udp", "sctp"];

const SORT_TERMS = [
  "id",
  "ftime",
  "ltime",
  "cbytes",
  "sbytes",
  "chost",
  "shost",
  "cport",
  "sport",
  "-id",
  "-ftime",
  "-ltime",
  "-cbytes",
  "-sbytes",
  "-chost",
  "-shost",
  "-cport",
  "-sport",
];

export default function suggest(
  query: string,
  cursorOffset: number,
  groupedTags: { [key: string]: TagInfo[] },
  converters: ConverterStatistics[] | null,
): SuggestionResults {
  // Try parser-based suggestions first
  const parserResult = _parserBasedSuggest(
    query,
    cursorOffset,
    groupedTags,
    converters,
  );
  if (parserResult) return parserResult;

  // Fall back to text-based suggestions
  return _textBasedSuggest(query, cursorOffset, groupedTags);
}

function _parserBasedSuggest(
  query: string,
  cursorOffset: number,
  groupedTags: { [key: string]: TagInfo[] },
  converters: ConverterStatistics[] | null,
): SuggestionResults | null {
  const parser = new nearley.Parser(queryGrammar);
  try {
    parser.feed(query);
  } catch {
    return null;
  }

  const targetElem = _findElementAtCursor(
    parser.results as QueryElement[],
    cursorOffset,
  );
  if (!targetElem) return null;

  const keyword = targetElem.keyword.value;
  if (
    ["service", "tag", "mark", "generated"].includes(keyword) &&
    targetElem.value !== undefined
  ) {
    const value = targetElem.value.value;
    const text = targetElem.value.text;
    const start = targetElem.value.col;
    const end = start + (text.length ?? 0) - 1;
    const tagsInGroup = groupedTags[keyword].map((t) => t.Name.split("/")[1]);
    const suggestions = tagsInGroup.filter(
      (t) => t.startsWith(value) && t !== value,
    );
    if (suggestions.length === 0) return null;
    return {
      suggestions,
      start,
      end,
      type: keyword,
    };
  } else if (
    keyword.endsWith("data") &&
    targetElem.converter != null &&
    converters !== null
  ) {
    const value = targetElem.converter.value;
    const text = targetElem.converter.text;
    const start = targetElem.converter.col;
    const end = start + (text.length ?? 0) - 1;
    const suggestions = converters
      .filter((c) => c.Name.startsWith(value) && c.Name !== value)
      .map((c) => c.Name);
    if (suggestions.length === 0) return null;
    return {
      suggestions,
      start,
      end,
      type: "data",
    };
  }
  return null;
}

function _extractTokenAtCursor(
  query: string,
  cursorOffset: number,
): { token: string; start: number; end: number } {
  const breakChars = " \t\n\r()";
  let start = cursorOffset;
  while (start > 0 && !breakChars.includes(query[start - 1])) {
    start--;
  }
  let end = cursorOffset;
  while (end < query.length && !breakChars.includes(query[end])) {
    end++;
  }
  return { token: query.slice(start, end), start, end };
}

function _textBasedSuggest(
  query: string,
  cursorOffset: number,
  groupedTags: { [key: string]: TagInfo[] },
): SuggestionResults {
  const empty: SuggestionResults = {
    suggestions: [],
    start: 0,
    end: 0,
    type: "keyword",
  };

  const { token, start, end } = _extractTokenAtCursor(query, cursorOffset);

  // Check if cursor is in a value (after ':')
  const colonIdx = token.indexOf(":");
  if (colonIdx !== -1 && cursorOffset > start + colonIdx) {
    const keyPart = token.slice(0, colonIdx).toLowerCase();
    // Strip negation/subquery prefix for keyword matching
    const cleanKey = keyPart.replace(/^[@a-z0-9]*:/, "").replace(/^[!-]/, "");
    const valuePart = token.slice(colonIdx + 1);
    // Handle last value after comma for multi-value filters
    const lastCommaIdx = valuePart.lastIndexOf(",");
    const currentValue =
      lastCommaIdx !== -1 ? valuePart.slice(lastCommaIdx + 1) : valuePart;
    const valueStart =
      lastCommaIdx !== -1
        ? start + colonIdx + 1 + lastCommaIdx + 1
        : start + colonIdx + 1;

    if (cleanKey === "protocol") {
      const suggestions = PROTOCOL_VALUES.filter(
        (v) => v.startsWith(currentValue) && v !== currentValue,
      );
      if (suggestions.length === 0) return empty;
      return { suggestions, start: valueStart, end, type: "keyword" };
    }
    if (cleanKey === "sort") {
      const suggestions = SORT_TERMS.filter(
        (v) => v.startsWith(currentValue) && v !== currentValue,
      );
      if (suggestions.length === 0) return empty;
      return { suggestions, start: valueStart, end, type: "keyword" };
    }
    // Tag-like value suggestions
    if (["service", "tag", "mark", "generated"].includes(cleanKey)) {
      const tagsInGroup = (groupedTags[cleanKey] ?? []).map(
        (t) => t.Name.split("/")[1],
      );
      const suggestions = tagsInGroup.filter(
        (t) => t.startsWith(currentValue) && t !== currentValue,
      );
      if (suggestions.length === 0) return empty;
      return {
        suggestions,
        start: valueStart,
        end,
        type: cleanKey,
      };
    }
    return empty;
  }

  // Keyword/operator context — strip negation prefix
  let prefix = token.toLowerCase();
  const negated = prefix.startsWith("-") || prefix.startsWith("!");
  if (negated) prefix = prefix.slice(1);

  if (prefix === "") return empty;

  const candidates = [...ALL_KEYWORDS, ...OPERATORS];
  const suggestions = candidates.filter(
    (k) => k.startsWith(prefix) && k !== prefix,
  );
  if (suggestions.length === 0) return empty;

  return {
    suggestions,
    start: negated ? start + 1 : start,
    end,
    type: "keyword",
  };
}

function _findElementAtCursor(
  results: QueryElement[],
  cursorOffset: number,
): ExpressionQueryElement | null {
  const elements = [...results];
  const isCursorInsideElement = (
    elem: ExpressionQueryElement,
    part: "value" | "converter",
  ) => {
    const partValue = elem[part];
    if (!partValue) return false;
    const valueStartOffset = partValue.col;
    const valueEndOffset = valueStartOffset + (partValue.text.length ?? 0);
    if (cursorOffset >= valueStartOffset && cursorOffset < valueEndOffset)
      return true;
    return false;
  };
  while (elements.length > 0) {
    const elem = elements.pop();
    if (elem === undefined) break;
    if (isExpression(elem)) {
      if (elem.value !== undefined && isCursorInsideElement(elem, "value"))
        return elem;
      if (
        elem.converter !== undefined &&
        isCursorInsideElement(elem, "converter")
      )
        return elem;
    } else if (isLogicExpression(elem)) {
      elements.push(...elem.expressions);
    } else if (isSubExpression(elem)) {
      if (elem.expression) elements.push(elem.expression);
    }
  }
  return null;
}
