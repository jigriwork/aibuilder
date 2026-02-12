import React from "react";
import Button from "../ui/Button";
import Card, { CardBody, CardHeader } from "../ui/Card";
import ListRow from "../ui/ListRow";
import EmptyState from "../ui/EmptyState";

function toRelativeTime(value) {
  const ts = Number(value);
  if (!Number.isFinite(ts)) return "Updated recently";
  const delta = Math.max(0, Date.now() - ts);
  const mins = Math.floor(delta / 60000);
  if (mins < 1) return "Updated just now";
  if (mins < 60) return `Updated ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days}d ago`;
}

export default function ProjectList({
  recentProjects,
  onOpenProject,
  onDeleteProject,
}) {
  return (
    <Card className="recent-projects-card">
      <CardHeader>
        <h2>Recent projects</h2>
      </CardHeader>
      <CardBody>
        {recentProjects.length === 0 ? (
          <EmptyState title="No projects yet" subtitle="Create your first game to see recent projects here." />
        ) : (
          <div className="recent-project-rows">
            {recentProjects.map((project) => (
              <ListRow
                key={project.id}
                title={project.title || project.name || "Untitled"}
                subtitle={toRelativeTime(project.updatedAt)}
                actions={(
                  <>
                    <Button variant="secondary" size="sm" onClick={() => onOpenProject?.(project.id)}>
                      Open
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        if (window.confirm(`Delete project "${project.name || "Untitled"}"?`)) {
                          onDeleteProject?.(project.id);
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </>
                )}
              />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
