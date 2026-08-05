// Safe regex operations: guard against polynomial ReDoS by validating input
// length before applying a regex to uncontrolled (user-provided) data.
//
// The CodeQL rule "Polynomial regular expression used on uncontrolled data"
// (js/polynomial-redos) flags patterns that can exhibit super-linear
// backtracking on crafted inputs. The recommended mitigation when the regex
// itself can't be simplified is to limit input length so the worst-case
// backtracking completes in reasonable time.
//
// These wrappers enforce a length ceiling before delegating to the native
// regex methods. Use them at every boundary where a regex touches data that
// originates outside the process: HTTP bodies/headers, URL paths, query
// parameters, user-submitted markdown/HTML, comment text, etc.
//
// ADR-0033: Safe-regex input-length guards.

/** 50 KB — generous enough for any legitimate user input (a comment body, a
 *  search query, a heading line) while keeping regex backtracking bound.  */
export const MAX_REGEX_INPUT = 50_000;

/** ReDoS input-length guard. Throws a descriptive error when `input` is longer
 *  than `maxLength`, otherwise returns `input` for chaining convenience. */
export function guardRegexInput(input: string, maxLength = MAX_REGEX_INPUT): string {
  if (input.length > maxLength) {
    throw new Error(
      `Input too long for regex operation: ${input.length} > ${maxLength}. ` +
        `Limit the input size to prevent ReDoS.`,
    );
  }
  return input;
}

/**
 * Safe `RegExp.prototype.test` with an input-length guard.
 * Usage: `if (safeTest(/pattern/, userInput)) { ... }`
 */
export function safeTest(regex: RegExp, input: string, maxLength?: number): boolean {
  guardRegexInput(input, maxLength);
  return regex.test(input);
}

/**
 * Safe `RegExp.prototype.exec` with an input-length guard.
 * Usage: `const m = safeExec(/pattern/, userInput);`
 */
export function safeExec(regex: RegExp, input: string, maxLength?: number): RegExpExecArray | null {
  guardRegexInput(input, maxLength);
  return regex.exec(input);
}

/**
 * Safe `String.prototype.match` with an input-length guard.
 * Usage: `const m = safeMatch(userInput, /pattern/);`
 */
export function safeMatch(
  input: string,
  regex: RegExp,
  maxLength?: number,
): RegExpMatchArray | null {
  guardRegexInput(input, maxLength);
  return input.match(regex);
}

/**
 * Safe `String.prototype.replace` with an input-length guard.
 * Usage: `const cleaned = safeReplace(userInput, /pattern/g, replacement);`
 */
export function safeReplace(
  input: string,
  regex: RegExp,
  replacement: string | ((substring: string, ...args: unknown[]) => string),
  maxLength?: number,
): string {
  guardRegexInput(input, maxLength);
  // Narrow the replacement type so TypeScript can resolve the correct
  // String.prototype.replace overload (string vs function replacer).
  if (typeof replacement === "string") {
    return input.replace(regex, replacement);
  }
  return input.replace(regex, replacement);
}

/**
 * Safe `String.prototype.split` with an input-length guard.
 * Usage: `const parts = safeSplit(userInput, /\s+/);`
 */
export function safeSplit(
  input: string,
  separator: RegExp | string,
  limit?: number,
  maxLength?: number,
): string[] {
  guardRegexInput(input, maxLength);
  return input.split(separator, limit);
}
