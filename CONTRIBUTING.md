# Contributing to Betsy CRM

Thank you for your interest in contributing to Betsy CRM! This document provides guidelines and information for contributors.

## 🚀 Quick Start for Contributors

### Prerequisites
- Node.js >= 18.18.0
- npm or yarn
- Git

### Setup Development Environment

1. **Fork and Clone**
   ```bash
   git clone https://github.com/your-username/Betsy.git
   cd Betsy
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Setup Environment**
   ```bash
   cp env.example .env.local
   # Edit .env.local with your settings
   ```

4. **Setup Database**
   ```bash
   npm run db:migrate
   npm run seed
   ```

5. **Start Development Server**
   ```bash
   npm run dev
   ```

6. **Access Application**
   - URL: http://localhost:3000
   - Demo Login: `master` / `master123`

## 📋 Development Guidelines

### Code Style
- Use TypeScript for all new code
- Follow existing code patterns and conventions
- Use meaningful variable and function names
- Add JSDoc comments for complex functions
- Use Prettier for code formatting

### Git Workflow
1. Create a feature branch from `main`
2. Make your changes
3. Test thoroughly
4. Commit with descriptive messages
5. Push to your fork
6. Create a Pull Request

### Commit Message Format
```
type(scope): description

Examples:
feat(auth): add password reset functionality
fix(ui): resolve form validation issue
docs(readme): update installation instructions
```

## 🧪 Testing

### Running Tests
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Test Categories
- **Unit Tests**: Individual component/function testing
- **Integration Tests**: API endpoint testing
- **E2E Tests**: Full user workflow testing

### Writing Tests
- Write tests for new features
- Ensure existing tests pass
- Aim for good test coverage
- Use descriptive test names

## 🐛 Bug Reports

### Before Reporting
1. Check existing issues
2. Try the latest version
3. Reproduce the issue
4. Check browser console for errors

### Bug Report Template
```markdown
**Bug Description**
A clear description of the bug.

**Steps to Reproduce**
1. Go to '...'
2. Click on '...'
3. See error

**Expected Behavior**
What should happen.

**Actual Behavior**
What actually happens.

**Environment**
- OS: [e.g. Windows 10]
- Browser: [e.g. Chrome 91]
- Version: [e.g. 1.0.0]

**Additional Context**
Any other relevant information.
```

## ✨ Feature Requests

### Before Requesting
1. Check existing feature requests
2. Consider if it fits the project scope
3. Think about implementation complexity

### Feature Request Template
```markdown
**Feature Description**
A clear description of the feature.

**Use Case**
Why is this feature needed?

**Proposed Solution**
How should this feature work?

**Alternatives Considered**
Other solutions you've considered.

**Additional Context**
Any other relevant information.
```

## 🏗️ Architecture Overview

### Project Structure
```
src/
├── app/                 # Next.js app directory
│   ├── api/            # API routes
│   ├── components/     # Reusable components
│   ├── config/         # Configuration pages
│   ├── produccion/     # Production module
│   ├── ventas/         # Sales module
│   └── estadisticas/   # Statistics module
├── lib/                # Utility functions
│   ├── auth.ts         # Authentication
│   ├── db.ts           # Database connection
│   ├── config.ts       # Configuration
│   └── auditLogger.ts # Audit logging
└── types/              # TypeScript definitions
```

### Key Technologies
- **Frontend**: Next.js 14, React, TypeScript
- **Backend**: Next.js API Routes
- **Database**: Prisma ORM with SQLite/PostgreSQL
- **Authentication**: NextAuth.js
- **UI**: Tailwind CSS, shadcn/ui
- **Validation**: Zod

### Database Schema
- **Users**: User management and authentication
- **Orders**: Sales orders (EA/RA types)
- **AuditLog**: Change tracking and audit trail
- **Configuration**: System settings and options

## 🔧 Development Tasks

### Common Tasks
- **New Feature**: Create feature branch, implement, test, PR
- **Bug Fix**: Create fix branch, implement fix, test, PR
- **Documentation**: Update relevant docs, PR
- **Refactoring**: Improve code without changing functionality

### Code Review Process
1. **Self Review**: Review your own code first
2. **Automated Checks**: Ensure CI passes
3. **Peer Review**: Get feedback from maintainers
4. **Testing**: Verify functionality works
5. **Merge**: Merge after approval

## 📚 Documentation

### Documentation Types
- **Code Comments**: Inline documentation
- **README**: Project overview and setup
- **API Docs**: API endpoint documentation
- **User Guides**: End-user documentation

### Writing Documentation
- Use clear, concise language
- Include examples where helpful
- Keep documentation up-to-date
- Use markdown formatting

## 🚀 Release Process

### Version Numbering
- **Major**: Breaking changes
- **Minor**: New features
- **Patch**: Bug fixes

### Release Checklist
- [ ] All tests pass
- [ ] Documentation updated
- [ ] Changelog updated
- [ ] Version bumped
- [ ] Release notes prepared

## 🤝 Community Guidelines

### Code of Conduct
- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- Follow the golden rule

### Communication
- **Issues**: Use GitHub issues for bugs and features
- **Discussions**: Use GitHub discussions for questions
- **Pull Requests**: Use PRs for code changes
- **Releases**: Check release notes for updates

## 📞 Getting Help

### Resources
- **Documentation**: Check project docs first
- **Issues**: Search existing issues
- **Discussions**: Ask questions in discussions
- **Discord**: Join our community server

### Contact
- **Maintainers**: @maintainer-username
- **Email**: support@betsy-crm.com
- **Website**: https://betsy-crm.com

## 🎯 Contribution Areas

### High Priority
- **Bug Fixes**: Critical issues and regressions
- **Security**: Security vulnerabilities
- **Performance**: Performance improvements
- **Accessibility**: A11y improvements

### Medium Priority
- **New Features**: User-requested features
- **UI/UX**: Interface improvements
- **Documentation**: Better docs and guides
- **Testing**: Test coverage improvements

### Low Priority
- **Refactoring**: Code quality improvements
- **Optimization**: Performance optimizations
- **Tooling**: Development tool improvements
- **Examples**: Code examples and tutorials

## 🏆 Recognition

### Contributor Recognition
- **Contributors**: Listed in README
- **Maintainers**: Special recognition
- **Bug Hunters**: Security issue finders
- **Documentation**: Documentation contributors

### Contribution Types
- **Code**: Feature development and bug fixes
- **Documentation**: Writing and improving docs
- **Testing**: Testing and quality assurance
- **Community**: Helping other contributors

Thank you for contributing to Betsy CRM! 🎉
