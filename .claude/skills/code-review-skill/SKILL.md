---
name: code-review-skill
description: |
  Provides comprehensive code review guidance for React 19, Vue 3, Angular 17+, Svelte 5,
  Rust, TypeScript, Java, Java 8, PHP, Ruby, Rails, Python, Django, FastAPI, Go, C#/.NET, Kotlin, Swift,
  Dart, Flutter, NestJS, C/C++, Zig, CSS/Less/Sass, Qt, and more.
  Covers architecture review, performance review, security audit, code quality anti-patterns,
  and common bugs across all ecosystems.
  Use when: reviewing pull requests, conducting PR reviews, code review, reviewing code changes,
  establishing review standards, mentoring developers, architecture reviews, security audits,
  performance reviews, checking code quality, finding bugs, giving feedback on code.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - WebFetch
---

# Code Review Skill

Transform code reviews from gatekeeping to knowledge sharing through constructive feedback, systematic analysis, and collaborative improvement.

## When to Use This Skill

- Reviewing pull requests and code changes
- Establishing code review standards for teams
- Mentoring junior developers through reviews
- Conducting architecture reviews
- Creating review checklists and guidelines
- Improving team collaboration
- Reducing code review cycle time
- Maintaining code quality standards

## Core Principles

### 1. The Review Mindset

**Goals of Code Review:**

- Catch bugs and edge cases
- Ensure code maintainability
- Share knowledge across team
- Enforce coding standards
- Improve design and architecture
- Build team culture

**Not the Goals:**

- Show off knowledge
- Nitpick formatting (use linters)
- Block progress unnecessarily
- Rewrite to your preference

### 2. Effective Feedback

**Good Feedback is:**

- Specific and actionable
- Educational, not judgmental
- Focused on the code, not the person
- Balanced (praise good work too)
- Prioritized (critical vs nice-to-have)

```markdown
❌ Bad: "This is wrong."
✅ Good: "This could cause a race condition when multiple users
         access simultaneously. Consider using a mutex here."

❌ Bad: "Why didn't you use X pattern?"
✅ Good: "Have you considered the Repository pattern? It would
         make this easier to test. Here's an example: [link]"

❌ Bad: "Rename this variable."
✅ Good: "[nit] Consider `userCount` instead of `uc` for
         clarity. Not blocking if you prefer to keep it."
```

### 3. Review Scope

**What to Review:**

- Logic correctness and edge cases
- Security vulnerabilities
- Performance implications
- Test coverage and quality
- Error handling
- Documentation and comments
- API design and naming
- Architectural fit

**What Not to Review Manually:**

- Code formatting (use Prettier, Black, etc.)
- Import organization
- Linting violations
- Simple typos

## Review Process

### Phase 1: Context Gathering (2-3 minutes)

Before diving into code, understand:

- Read PR description and linked issue
- Check PR size (>400 lines? Ask to split)
- Review CI/CD status (tests passing?)
- Understand the business requirement
- Note any relevant architectural decisions

### Phase 2: High-Level Review (5-10 minutes)

- **Architecture & Design** - Does the solution fit the problem?
  - Check: SOLID principles, coupling/cohesion, anti-patterns
- **Performance Assessment** - Are there performance concerns?
  - Check: Algorithm complexity, N+1 queries, memory usage
- **File Organization** - Are new files in the right places?
- **Testing Strategy** - Are there tests covering edge cases?

### Phase 3: Line-by-Line Review (10-20 minutes)

For each file, check:

- **Logic & Correctness** - Edge cases, off-by-one, null checks, race conditions
- **Security** - Input validation, injection risks, XSS, sensitive data
- **Performance** - N+1 queries, unnecessary loops, memory leaks
- **Maintainability** - Clear names, single responsibility, comments
- **Reuse** - Before accepting new code, search for existing utilities/helpers that could replace it. Check adjacent files and shared modules for similar patterns. Watch for anti-patterns like parameter sprawl, leaky abstractions, nested conditionals, stringly-typed code, TOCTOU, and no-op updates.

### Phase 4: Summary & Decision (2-3 minutes)

- Summarize key concerns
- Highlight what you liked
- Make clear decision:
  - ✅ Approve
  - 💬 Comment (minor suggestions)
  - 🔄 Request Changes (must address)
- Offer to pair if complex

### Delivering the Review

- When reviewing a GitHub PR, leave each finding as an inline comment on its line of the PR (e.g. a review posted with `gh api repos/{owner}/{repo}/pulls/{number}/reviews`), with the summary and decision as the review body.
- If you can't leave inline comments (no PR, no `gh` access or auth, the post fails), start your review with a line in CAPS saying so, e.g. `COULD NOT LEAVE INLINE COMMENTS ON THE PR: <reason>.`, and give the full review in your output instead.

## Review Techniques

### Technique 1: The Checklist Method

Use checklists for consistent reviews, covering the scope and phases above (including a security pass: input validation, injection, XSS, secrets, authorization).

### Technique 2: The Question Approach

Instead of stating problems, ask questions:

```markdown
❌ "This will fail if the list is empty."
✅ "What happens if `items` is an empty array?"

❌ "You need error handling here."
✅ "How should this behave if the API call fails?"
```

### Technique 3: Suggest, Don't Command

Use collaborative language:

```markdown
❌ "You must change this to use async/await"
✅ "Suggestion: async/await might make this more readable. What do you think?"

❌ "Extract this into a function"
✅ "This logic appears in 3 places. Would it make sense to extract it?"
```

### Technique 4: Differentiate Severity

Use labels to indicate priority:

- 🔴 `[blocking]` - Must fix before merge
- 🟡 `[important]` - Should fix, discuss if disagree
- 🟢 `[nit]` - Nice to have, not blocking
- 💡 `[suggestion]` - Alternative approach to consider
- 📚 `[learning]` - Educational comment, no action needed
- 🎉 `[praise]` - Good work, keep it up!

**Severity levels:** 🔴 / 🟡 / 🟢 are the three severity tiers — 🔴 blocks the merge, 🟡 should be addressed, 🟢 is optional. The remaining markers (💡 / 📚 / 🎉) are non-blocking annotations.

## Language-Specific Focus

Key topics to check by language/framework:

| Language/Framework | Key Topics |
| --- | --- |
| React | Hooks, useEffect, React 19 Actions, RSC, Suspense, TanStack Query v5 |
| Vue 3 | Composition API, reactivity system, Props/Emits, Watchers, Composables |
| Angular 17+ | Signals, Standalone, RxJS, Zoneless, template optimization, testing, route guards, HttpInterceptor |
| Rust | Ownership/borrowing, unsafe review, async code, cancellation safety, error handling |
| TypeScript | Type safety, async/await, immutability, testing, module resolution, TS 5.x |
| Python | Mutable default arguments, exception handling, class attributes |
| Django / DRF | Security review, N+1 queries, serializer anti-patterns, ViewSets, async views |
| FastAPI | Depends, Pydantic v2 validation, async correctness, sessions/N+1, auth vs authorization, test-driven verification |
| Java | Java 17/21 features, Spring Boot 3, virtual threads, Stream/Optional |
| Java 8 / Legacy | Java 8, Spring Boot 2, javax.*, Stream/Optional, java.time, CompletableFuture |
| PHP | PHP 8.x type system, PDO, security review, Composer, PHPUnit/PHPStan |
| Ruby / Rails | Ruby semantics, Rails 8, Active Record, Active Job, security, testing |
| C# / .NET | C# 12 features, async programming, EF Core performance, ASP.NET Core, LINQ |
| Go | Error handling, goroutines/channels, context, interface design |
| Kotlin / Android | Coroutines, Flow, Jetpack Compose, null safety, memory leaks, architecture patterns |
| Swift / SwiftUI | Optionals, Swift Concurrency, Sendable/actors, SwiftUI property wrappers, value vs reference types, API design |
| Dart / Flutter | Widget rebuilds, const constructors, null safety, isolates, async in build, Riverpod/Bloc, platform channels, keys, disposal |
| NestJS | Dependency injection, layered architecture, DTO validation, Guards/Interceptors, circular dependencies |
| Svelte / SvelteKit | Runes, load functions, form actions, store migration, SSR/CSR boundaries |
| C | Pointers/buffers, memory safety, UB, secure coding, portability, testing |
| C++ | RAII, smart pointers, C++20/23, constexpr, testing |
| Zig | Allocators, error unions, defer/errdefer, comptime, C interop |
| CSS/Less/Sass | Variable conventions, !important, performance, responsive design, compatibility |
| Qt | Object model, signals/slots, Model/View, QML, Qt6 migration, testing |

## Cross-Cutting Concerns

Language-agnostic patterns applicable to all code reviews:

| Topic | Key Topics |
| --- | --- |
| Architecture | SOLID, anti-patterns, coupling/cohesion, dependency direction |
| Performance | Web Vitals, N+1, algorithm complexity, memory leaks, caching |
| Security | SQLi, XSS, CSRF, SSRF, IDOR, command injection |
| Universal Quality | Reuse audit, parameter sprawl, leaky abstractions, nested conditionals, stringly-typed code, TOCTOU, no-op updates, redundant state |
| Common Bugs | Language-specific bug patterns, common pitfalls |
| SQL Injection | Parameterized queries, ORM safety, dynamic identifiers |
| XSS | Output encoding, CSP, input validation vs encoding |
| N+1 Queries | Eager loading, batch fetching, DataLoader |
| Error Handling | Fail fast, error hierarchy, anti-patterns, logging |
| Async & Concurrency | async/await, actors, structured concurrency, cancellation |
