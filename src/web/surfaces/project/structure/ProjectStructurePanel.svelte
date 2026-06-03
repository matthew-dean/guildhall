<script lang="ts">
  import Stack from '../../../lib/Stack.svelte'
  import { projectFetch } from '../../../lib/project-routes.js'
  import { createProjectGraphStore } from './project-graph-store.svelte.js'
  import ProjectGraphPanel from './ProjectGraphPanel.svelte'
  import StructuralMapReviewPanel from './StructuralMapReviewPanel.svelte'

  const graphStore = createProjectGraphStore(projectFetch)
</script>

<Stack gap="5">
  <StructuralMapReviewPanel />
  <ProjectGraphPanel store={graphStore} />
</Stack>
