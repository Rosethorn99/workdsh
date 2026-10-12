# Langflow source attribution and integration boundary

Upstream: https://github.com/langflow-ai/langflow
Version: v1.12.5
Commit: 52622284d3bbc6d2cddc7a4b0bf18b2161e4b88c
License: MIT, retained in LICENSE.

The five files under upstream/ are unchanged reference copies. source-manifest.json records SHA-256 hashes verified against the pinned commit.

The executable helper-lines and fit-view-options modules retain original source with attribution headers. ConnectionLine adapts the original path geometry to remove Langflow's global store. NodeCard and NoteCard are WorkDSH implementations using the upstream layout and interaction as references; they do not mount the complete Langflow GenericNode, NoteNode or FlowPage.

The component library, capabilities, drafts, version snapshots, file receipts, approval and runtime belong to WorkDSH. Execution continues through the published official DSH Session Controller, Agent, Team, Skill and MCP APIs. Read/write file components are Agent task recipes with declared inputs and verified outputs.

This package does not ship the Langflow Python service, original component ecosystem, Playground, RAG engine, or a general Langflow JSON importer. Complete Langflow subflows require a separately installed runtime and a versioned API adapter.
