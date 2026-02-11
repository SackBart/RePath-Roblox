# Changelog

All notable changes to the "RePath Roblox" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] (suggestions to add?)

### Added

- Type definitions for project.json structure (`ProjectJson`, `ProjectTreeNode`)
- JSDoc comments for public functions
- Validation for project.json tree property
- `.vscodeignore` for extension packaging

### Changed

- Replaced `any` types with proper TypeScript interfaces
- Updated error logging to use `console.error` for error cases

### Fixed

- Unused parameter warning in `activate()` function
- Iterator bug in `getProjectJson()` (used `for...in` instead of `for...of`)
- Missing semicolons per ESLint configuration

### Removed

- Unused dependencies: `axios`, `fast-xml-parser`
- Debug logging loop in `getProjectJson()`

## [0.0.2] - Previous Release (you've create)

### Added

- Initial release with automatic path refactoring
- Support for Rojo project.json files
- Handling of .server, .client, .shared suffixes
- Support for init files

## [0.0.1] - Initial Release (you've create)

### Added

- Basic extension structure
