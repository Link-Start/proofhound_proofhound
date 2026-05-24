Use these techniques as a toolbox. Pick one or two that fit the diagnosed error pattern; do not stack every technique into one prompt.

## 1. Chain-of-Thought
Ask the model to reason through explicit steps before the final answer. Useful for ambiguous boundaries or multi-condition judgments.

## 2. Few-shot Examples
Add 2-5 input-to-expected-output examples. Choose representative boundary cases with balanced positive and negative coverage.

## 3. Terminology / Class Boundary Clarification
Define confusing labels and decision boundaries precisely, especially for semantically adjacent classes.

## 4. Hard Output Constraints
When free-form output causes parse errors, make the format constraints explicit and strict.

## 5. Decomposition
Break a complex judgment into smaller sub-decisions before the final label.

## 6. Negative Examples
Show cases that must not be classified a certain way, especially for recurring mistakes.

## 7. Chain-of-Verification
Ask the model to make an initial decision, then check whether evidence supports an alternative class.

## 8. Boundary Pinning
Anchor both sides of a confusing class boundary with concrete inclusion and exclusion cues.
