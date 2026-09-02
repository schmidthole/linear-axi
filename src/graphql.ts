export const PAGE_INFO = `pageInfo { hasNextPage endCursor }`;

export const ISSUE_LIST_SELECTION = `
  id identifier title priority estimate dueDate updatedAt archivedAt url
  state { id name type }
  assignee { id name email }
  team { id key name }
  project { id name }
  labels { nodes { id name } }
`;

export const ISSUE_DETAIL_SELECTION = `
  ${ISSUE_LIST_SELECTION}
  description createdAt completedAt canceledAt trashed
  creator { id name email }
  parent { id identifier title }
  children(first: 100) { nodes { id identifier title state { name } } }
  comments(first: 100) { nodes { id body createdAt updatedAt user { id name email } } }
  relations(first: 100) { nodes { id type relatedIssue { id identifier title } } }
  inverseRelations(first: 100) { nodes { id type issue { id identifier title } } }
`;

export const PROJECT_LIST_SELECTION = `
  id name slugId description icon color priority startDate targetDate updatedAt archivedAt url trashed
  status { id name type color }
  lead { id name email }
  teams(first: 50) { nodes { id key name } }
  labels(first: 50) { nodes { id name } }
`;

export const PROJECT_DETAIL_SELECTION = `
  ${PROJECT_LIST_SELECTION}
  content createdAt completedAt canceledAt
  creator { id name email }
  projectMilestones(first: 100) { nodes { id name description targetDate sortOrder status } }
  issues(first: 100) { nodes { id identifier title state { name } assignee { name } } }
  initiatives(first: 100) { nodes { id name status } }
  documents(first: 100) { nodes { id title url } }
`;

export const INITIATIVE_LIST_SELECTION = `
  id name slugId description icon color priority status targetDate updatedAt archivedAt url trashed
  owner { id name email }
  labels(first: 50) { nodes { id name } }
`;

export const INITIATIVE_DETAIL_SELECTION = `
  ${INITIATIVE_LIST_SELECTION}
  content createdAt completedAt canceledAt
  creator { id name email }
  projects(first: 100) { nodes { id name status { name type } } }
  documents(first: 100) { nodes { id title url } }
`;

export const DOCUMENT_LIST_SELECTION = `
  id title icon color updatedAt archivedAt url trashed
  creator { id name email }
  owner { id name email }
  project { id name }
  initiative { id name }
  team { id key name }
  issue { id identifier title }
`;

export const DOCUMENT_DETAIL_SELECTION = `
  ${DOCUMENT_LIST_SELECTION}
  content createdAt
  comments(first: 100) { nodes { id body createdAt user { id name email } } }
`;

export const MILESTONE_SELECTION = `id name description targetDate sortOrder status project { id name }`;
export const PROJECT_STATUS_SELECTION = `id name color description type archivedAt team { id key name }`;
export const COMMENT_SELECTION = `id body createdAt updatedAt user { id name email }`;
export const RELATION_SELECTION = `id type issue { id identifier title } relatedIssue { id identifier title }`;

export interface LinearNode {
  id: string;
  identifier?: string;
  name?: string;
  title?: string;
  key?: string;
  slugId?: string;
  customIdentifier?: string;
  email?: string;
  displayName?: string;
  team?: { id: string; key?: string; name?: string } | null;
  project?: { id: string; name?: string } | null;
  initiative?: { id: string; name?: string } | null;
}
