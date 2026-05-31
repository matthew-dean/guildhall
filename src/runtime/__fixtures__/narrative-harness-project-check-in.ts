export const narrativeHarnessProjectFiles = [
  {
    path: 'README.md',
    text: [
      '# Narrative Harness',
      '',
      'Narrative Harness is a research and design workspace for fiction-writing software that can help an author build, draft, and revise a coherent novel.',
      'The target is fiction: novels, novellas, serialized fiction, short fiction, and fiction-adjacent narrative forms.',
      'It focuses on character journey, causality, motivation, scene inventory, chapter purpose, reader knowledge, theme, and author voice.',
    ].join('\n'),
  },
  {
    path: 'docs/index.md',
    text: [
      '# Narrative Harness',
      '',
      'The working analogy is Guildhall for novels. A coordinator protects the project intent and author voice.',
      'A novel can be structurally elegant and still fail because the reader cannot tell who knows what.',
      'The project should preserve artistic intent, reader experience, and imagined-world coherence.',
      'The commercial product direction is quiet UI, readability-protected prose, and print-quality output.',
    ].join('\n'),
  },
  {
    path: '.guildhall/TASKS.json',
    text: JSON.stringify({
      tasks: [
        {
          id: 'author-voice-loop-mvp',
          title: 'Implement author voice feedback loop MVP',
          description: 'Add a first-pass mechanism that evaluates draft text against defined author voice constraints and returns actionable feedback.',
        },
        {
          id: 'coherence-reviewer-mvp',
          title: 'Build first coherence reviewer MVP',
          description: 'Implement one reviewer end-to-end to validate the architecture in code.',
        },
      ],
    }),
  },
]

export const narrativeHarnessBadCheckInAnswers = [
  {
    questionId: 'product-goals-q-1',
    prompt: 'What outcome would make this project successful?',
    answer: 'It can generate a whole GOOD novel from start to finish, given enough story details.',
  },
  {
    questionId: 'product-goals-q-2',
    prompt: 'What observable result would tell you this project is succeeding?',
    answer: 'I guess some kind of reader feedback?',
  },
  {
    questionId: 'workflows-q-1',
    prompt: 'What workflow or day-to-day constraint should Guildhall understand about this project?',
    answer: "Hmm I don't understand the nature of the question?",
  },
  {
    questionId: 'design-quality-q-1',
    prompt: 'What design-system source, interaction pattern, palette direction, or visual proof should Guildhall remember for this project?',
    answer: 'Should Guildhall remember? I guess it should be reader / writer friendly -- muted palette, clean lines, generate whitespace, minimalist',
  },
]
