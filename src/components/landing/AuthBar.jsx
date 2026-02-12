import React from "react";
import Button from "../ui/Button";
import Card, { CardBody } from "../ui/Card";
import Input from "../ui/Input";

export default function AuthBar({
  user,
  showSignIn,
  authMessage,
  nameInput,
  emailInput,
  setNameInput,
  setEmailInput,
  onContinueAsGuest,
  onSignInToggle,
  onSignInSubmit,
}) {
  return (
    <>
      <div className="auth-bar">
        {user?.isGuest ? (
          <>
            <p>
              Mode: <strong>Guest</strong>
            </p>
            <Button variant="ghost" size="sm" onClick={() => onContinueAsGuest?.()}>
              Continue as Guest
            </Button>
            <Button variant="secondary" size="sm" onClick={onSignInToggle}>
              Sign in
            </Button>
          </>
        ) : (
          <>
            <p>
              Signed in as <strong>{user?.name || user?.email}</strong>
            </p>
            <Button variant="ghost" size="sm" onClick={() => onContinueAsGuest?.()}>
              Switch to Guest
            </Button>
          </>
        )}
      </div>

      {showSignIn ? (
        <Card className="signin-card">
          <CardBody className="signin-grid">
            <Input
              type="text"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="Name"
              aria-label="Name"
            />
            <Input
              type="email"
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              placeholder="Email"
              aria-label="Email"
            />
            <Button type="button" onClick={onSignInSubmit}>
              Save Sign-in
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {authMessage ? <p className="auth-message">{authMessage}</p> : null}
    </>
  );
}
