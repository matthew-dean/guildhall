const textRoleDefinitions = {
  'display-title': {
    size: '--gh-type-size-display-title',
    weight: '--gh-type-weight-strong',
    lineHeight: '--gh-type-line-height-tight',
    color: '--gh-color-text-primary',
  },
  'page-title': {
    size: '--gh-type-size-page-title',
    weight: '--gh-type-weight-strong',
    lineHeight: '--gh-type-line-height-tight',
    color: '--gh-color-text-primary',
  },
  'section-title': {
    size: '--gh-type-size-section-title',
    weight: '--gh-type-weight-strong',
    lineHeight: '--gh-type-line-height-tight',
    color: '--gh-color-text-primary',
  },
  'panel-title': {
    size: '--gh-type-size-panel-title',
    weight: '--gh-type-weight-strong',
    lineHeight: '--gh-type-line-height-tight',
    color: '--gh-color-text-primary',
  },
  body: {
    size: '--gh-type-size-body',
    weight: '--gh-type-weight-body',
    lineHeight: '--gh-type-line-height-body',
    color: '--gh-color-text-body',
  },
  'body-strong': {
    size: '--gh-type-size-body',
    weight: '--gh-type-weight-strong',
    lineHeight: '--gh-type-line-height-body',
    color: '--gh-color-text-body',
  },
  'row-title': {
    size: '--gh-type-size-meta',
    weight: '--gh-type-weight-medium',
    lineHeight: '--gh-type-line-height-tight',
    color: '--gh-color-text-secondary',
  },
  'row-title-current': {
    size: '--gh-type-size-meta',
    weight: '--gh-type-weight-strong',
    lineHeight: '--gh-type-line-height-tight',
    color: '--gh-color-text-primary',
  },
  meta: {
    size: '--gh-type-size-meta',
    weight: '--gh-type-weight-body',
    lineHeight: '--gh-type-line-height-body',
    color: '--gh-color-text-muted',
  },
  caption: {
    size: '--gh-type-size-caption',
    weight: '--gh-type-weight-body',
    lineHeight: '--gh-type-line-height-body',
    color: '--gh-color-text-muted',
  },
  eyebrow: {
    size: '--gh-type-size-eyebrow',
    weight: '--gh-type-weight-strong',
    lineHeight: '--gh-type-line-height-tight',
    color: '--gh-color-text-muted',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  history: {
    size: '--gh-type-size-meta',
    weight: '--gh-type-weight-body',
    lineHeight: '--gh-type-line-height-body',
    color: '--gh-color-text-disabled',
  },
  action: {
    size: '--gh-type-size-body',
    weight: '--gh-type-weight-strong',
    lineHeight: '--gh-type-line-height-control',
    color: '--gh-color-text-primary',
  },
  state: {
    size: '--gh-type-size-caption',
    weight: '--gh-type-weight-medium',
    lineHeight: '--gh-type-line-height-control',
    color: '--gh-color-text-muted',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  code: {
    size: '--gh-type-size-code',
    weight: '--gh-type-weight-body',
    lineHeight: '--gh-type-line-height-body',
    color: '--gh-color-text-body',
  },
}

export const textRoleOrder = Object.freeze(Object.keys(textRoleDefinitions))

export default Object.freeze(textRoleDefinitions)
