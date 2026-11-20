// The check list of an e2e run (`e2e.mjs`, `e2e-mcp.mjs`): each check is printed as it is made and kept for the
// run's JSON result; `fatal` stops a run whose next checks could not mean anything.

/** A fresh list: `results` for the JSON result, `check(name, ok, details)` to add one, returning `ok`. */
export function createChecks() {
  const results = []
  function check(name, ok, details) {
    results.push({ name, ok: Boolean(ok), details })
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${details === undefined ? '' : ' ' + JSON.stringify(details)}`)
    return ok
  }
  return { results, check }
}

/** Stop the run with `message`; the run's own `catch` records it as the failed "run completed". */
export function fatal(message) {
  throw new Error(message)
}
