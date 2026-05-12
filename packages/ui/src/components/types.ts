import type { Snippet } from 'svelte'
import type { HTMLAttributes } from 'svelte/elements'

import type {
  GuildhallDensityMode,
  GuildhallEmphasisMode,
  GuildhallShellMode,
  GuildhallTypeRole,
} from '../tokens.js'

export type SectionHeaderHeadingTag = 'h1' | 'h2' | 'h3' | 'h4'
export type SectionHeaderAlign = 'start' | 'center'

export interface SectionHeaderProps extends HTMLAttributes<HTMLElement> {
  title: string
  description?: string
  eyebrow?: string
  headingTag?: SectionHeaderHeadingTag
  align?: SectionHeaderAlign
  mode?: GuildhallShellMode
  density?: GuildhallDensityMode
  titleRole?: Extract<GuildhallTypeRole, 'title'>
  descriptionRole?: Extract<GuildhallTypeRole, 'body'>
  meta?: Snippet
  actions?: Snippet
}

export type NoticeBandTone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger'
export type NoticeBandRole = 'note' | 'status' | 'alert'
export type NoticeBandHeadingTag = 'h2' | 'h3' | 'h4'

export interface NoticeBandProps extends Omit<HTMLAttributes<HTMLElement>, 'role'> {
  tone?: NoticeBandTone
  role?: NoticeBandRole
  mode?: GuildhallShellMode
  density?: GuildhallDensityMode
  headingTag?: NoticeBandHeadingTag
  title?: string
  label?: string
  ariaLabel?: string
  children?: Snippet
  actions?: Snippet
}

export type FrameCardTone = 'default' | 'info' | 'accent' | 'ok' | 'warn' | 'danger'
export type FrameCardPadding = 'compact' | 'default' | 'roomy'
export type FrameCardElementTag = 'article' | 'div' | 'section'

export interface FrameCardProps extends HTMLAttributes<HTMLElement> {
  as?: FrameCardElementTag
  tone?: FrameCardTone
  padding?: FrameCardPadding
  mode?: GuildhallShellMode
  density?: GuildhallDensityMode
  ariaLabel?: string
  children?: Snippet
  header?: Snippet
  footer?: Snippet
}

export type StatusPillTone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger' | 'accent'

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  label: string
  tone?: StatusPillTone
  mode?: GuildhallShellMode
  density?: GuildhallDensityMode
  emphasis?: GuildhallEmphasisMode
}

export interface HeroBandBadge {
  label: string
  tone?: StatusPillTone
  emphasis?: GuildhallEmphasisMode
}

export interface HeroBandStat {
  label: string
  value: string
  detail?: string
}

export type HeroBandHeadingTag = 'h1' | 'h2' | 'h3' | 'h4'

export interface HeroBandProps extends HTMLAttributes<HTMLElement> {
  eyebrow?: string
  title: string
  description: string
  note?: string
  headingTag?: HeroBandHeadingTag
  mode?: GuildhallShellMode
  density?: GuildhallDensityMode
  badges?: readonly HeroBandBadge[]
  stats?: readonly HeroBandStat[]
  media?: Snippet
  actions?: Snippet
}

export type AnnotatedScreenshotTone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger' | 'accent'

export interface AnnotatedScreenshotAnnotation {
  id: string
  label: string
  detail?: string
  x: number
  y: number
  tone?: AnnotatedScreenshotTone
}

export interface AnnotatedScreenshotProps extends HTMLAttributes<HTMLElement> {
  src: string
  alt: string
  title?: string
  description?: string
  eyebrow?: string
  caption?: string
  headingTag?: HeroBandHeadingTag
  aspectRatio?: number | `${number} / ${number}`
  mode?: GuildhallShellMode
  density?: GuildhallDensityMode
  annotations?: readonly AnnotatedScreenshotAnnotation[]
}

export interface GuildDiagramNode {
  id: string
  label: string
  detail?: string
  x: number
  y: number
  tone?: AnnotatedScreenshotTone
}

export interface GuildDiagramLink {
  from: string
  to: string
  label?: string
}

export interface GuildDiagramProps extends HTMLAttributes<HTMLElement> {
  title?: string
  description?: string
  eyebrow?: string
  headingTag?: HeroBandHeadingTag
  mode?: GuildhallShellMode
  density?: GuildhallDensityMode
  nodes?: readonly GuildDiagramNode[]
  links?: readonly GuildDiagramLink[]
}
