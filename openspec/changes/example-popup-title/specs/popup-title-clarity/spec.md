## Purpose

Make the sample developer-tool popup immediately understandable without changing its controls or runtime behavior.

## ADDED Requirements

### Requirement: Popup displays a clear sample title

The popup SHALL display the title `Web 开发者工具 · 示例` as its primary heading.

#### Scenario: User opens the extension popup

- **WHEN** the user opens the extension action popup
- **THEN** the popup displays `Web 开发者工具 · 示例` as its primary heading
- **AND** the element selection and Console log actions remain available and unchanged
