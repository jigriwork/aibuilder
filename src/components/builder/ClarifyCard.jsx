import React from "react";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Card, { CardBody } from "../ui/Card";

export default function ClarifyCard({
  pendingClarifyQuestion,
  clarifyAnswers,
  setClarifyAnswers,
  setComposerInput,
  onSubmit,
}) {
  if (!pendingClarifyQuestion) return null;

  const pendingChoices = Array.isArray(pendingClarifyQuestion.choices) ? pendingClarifyQuestion.choices : [];

  return (
    <Card className="clarify-inline-card">
      <CardBody>
        <h4>Quick clarification</h4>
        <p>{pendingClarifyQuestion.text}</p>
        {pendingChoices.length > 0 ? (
          <div className="clarify-choices">
            {pendingChoices.map((choice) => (
              <Button key={choice} size="sm" variant="secondary" onClick={() => setComposerInput(choice)}>
                {choice}
              </Button>
            ))}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
