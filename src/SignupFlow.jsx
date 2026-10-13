import { useState } from "react";
import { X, ArrowRight, ArrowLeft, CheckCircle } from "lucide-react";
import { C, GR, IN, Logo, DISCOUNTS, DISCOUNT_KEYS } from "./shared.jsx";
import { useAuth } from "./AuthContext.jsx";
import { resubmitVerification } from "./api.js";
import CameraCapture from "./CameraCapture.jsx";

function Field({ label, ...props }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span
        style={{
          display: "block",
          fontFamily: IN,
          fontSize: 11.5,
          color: C.muted,
          marginBottom: 4,
        }}
      >
        {label}
      </span>
      <input
        {...props}
        style={{
          width: "100%",
          padding: "12px 14px",
          borderRadius: 12,
          border: `1.5px solid ${C.border}`,
          fontFamily: IN,
          fontSize: 14,
          outline: "none",
          boxSizing: "border-box",
        }}
      />
    </label>
  );
}

const CONSENT_TEXT =
  "I agree that Gravitry and the Mary Cris Complex TODA may collect my government ID photo and selfie only to check that I live in Mary Cris Complex, as allowed under the Data Privacy Act of 2012 (RA 10173). Authorized TODA staff will review them, and the photos are deleted once my account is approved or rejected.";

const CONSENT_DISCOUNT_TEXT =
  " I also agree that TODA staff may review the photo of my discount ID only to check that I qualify for the fare discount, and that it is deleted once they decide.";

// resubmit = true: the passenger already has an account (it was rejected), so
// only the photo steps are shown.
export default function SignupFlow({ resubmit = false, onClose }) {
  const { signup, refresh, user } = useAuth();

  // Which discount (if any) this account is asking for. For a new signup the
  // passenger picks it on the first step; for a resubmit it is whatever they
  // originally asked for.
  const [claim, setClaim] = useState(""); // "" | "student" | "senior" | "pwd"
  const activeClaim = resubmit ? user?.discountClaim || "" : claim;

  const steps = [
    ...(resubmit ? [] : ["details"]),
    "id",
    ...(activeClaim ? ["discountId"] : []),
    "selfie",
    "review",
  ];
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex];

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [idPhoto, setIdPhoto] = useState(null);
  const [discountIdPhoto, setDiscountIdPhoto] = useState(null);
  const [selfie, setSelfie] = useState(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const discountName = DISCOUNTS[activeClaim]?.label || "";
  const discountIdName = DISCOUNTS[activeClaim]?.idName || "discount ID";

  const validate = () => {
    if (step === "details") {
      if (!name.trim()) return "Please enter your full name.";
      if (!address.trim())
        return "Please enter your home address in Mary Cris Complex.";
      if (!username.trim()) return "Please choose a username.";
      if (password.length < 8) return "Password must be at least 8 characters.";
      if (password !== confirm) return "Passwords don't match.";
    }
    if (step === "id" && !idPhoto)
      return "Please take a photo of your government ID.";
    if (step === "discountId" && !discountIdPhoto)
      return `Please take a photo of your ${discountIdName}.`;
    if (step === "selfie" && !selfie) return "Please take a selfie.";
    if (step === "review" && !consent)
      return "Please agree to the terms to continue.";
    return null;
  };

  const next = () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  };

  const back = () => {
    setError(null);
    setStepIndex((i) => Math.max(i - 1, 0));
  };

  const submit = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (resubmit) {
        await resubmitVerification({
          idPhoto,
          selfie,
          consent: true,
          ...(activeClaim ? { discountIdPhoto } : {}),
        });
        await refresh();
      } else {
        await signup({
          username: username.trim(),
          password,
          name: name.trim(),
          phone: phone.trim(),
          address: address.trim(),
          idPhoto,
          selfie,
          consent: true,
          ...(activeClaim
            ? { discountClaim: activeClaim, discountIdPhoto }
            : {}),
        });
      }
      onClose();
    } catch (err) {
      const msg = err.message
        ? err.message.replace(/^API .* failed: /, "")
        : "";
      setError(msg || "Could not submit. Please try again.");
      if (/username/i.test(msg)) setStepIndex(0);
    }
    setSubmitting(false);
  };

  const titles = {
    details: [
      "Your details",
      "Tell us who you are. Use the address that appears on your ID.",
    ],
    id: [
      "Government ID",
      "Take a clear photo of a government-issued ID. The address should be readable.",
    ],
    discountId: [
      `${discountName} discount ID`,
      `Take a clear photo of your ${discountIdName}. It must clearly show that you are a ${discountName.toLowerCase()}.`,
    ],
    selfie: [
      "Selfie",
      "Take a selfie right now. Face the camera in good light, no mask or sunglasses.",
    ],
    review: ["Review and submit", "Check your photos and agree to the terms."],
  };

  const reviewPhotos = [
    ["ID", idPhoto],
    ...(activeClaim ? [[discountIdName, discountIdPhoto]] : []),
    ["Selfie", selfie],
  ];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#fff",
        zIndex: 3000,
        overflowY: "auto",
      }}
    >
      <div
        style={{
          maxWidth: 480,
          margin: "0 auto",
          padding:
            "calc(16px + var(--safe-top)) 20px calc(28px + var(--safe-bottom))",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <Logo size={24} dark />
          <button
            type="button"
            onClick={onClose}
            style={{
              background: C.surface,
              border: "none",
              borderRadius: 8,
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <X size={15} color={C.muted} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {steps.map((s, i) => (
            <div
              key={s}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 4,
                background: i <= stepIndex ? C.green : C.border,
              }}
            />
          ))}
        </div>

        <p
          style={{
            fontFamily: IN,
            fontSize: 11.5,
            color: C.muted,
            margin: "0 0 2px",
          }}
        >
          Step {stepIndex + 1} of {steps.length}
        </p>
        <h2
          style={{
            fontFamily: GR,
            fontWeight: 700,
            fontSize: 20,
            color: C.text,
            margin: "0 0 4px",
          }}
        >
          {titles[step][0]}
        </h2>
        <p
          style={{
            fontFamily: IN,
            fontSize: 13,
            color: C.muted,
            margin: "0 0 16px",
          }}
        >
          {titles[step][1]}
        </p>

        {error && (
          <div
            style={{
              background: "#FEE2E2",
              color: "#991B1B",
              borderRadius: 10,
              padding: "8px 12px",
              fontSize: 12.5,
              fontFamily: IN,
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}

        {step === "details" && (
          <div>
            <Field
              label="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
            <Field
              label="Home address in Mary Cris Complex"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              autoComplete="street-address"
            />
            <Field
              label="Phone (optional)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
            />

            <div style={{ marginBottom: 14 }}>
              <span
                style={{
                  display: "block",
                  fontFamily: IN,
                  fontSize: 11.5,
                  color: C.muted,
                  marginBottom: 6,
                }}
              >
                Fare discount (20% off)
              </span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[
                  ["", "None"],
                  ...DISCOUNT_KEYS.map((k) => [k, DISCOUNTS[k].label]),
                ].map(([key, label]) => (
                  <button
                    key={key || "none"}
                    type="button"
                    onClick={() => {
                      setClaim(key);
                      setDiscountIdPhoto(null);
                    }}
                    style={{
                      padding: "9px 14px",
                      borderRadius: 20,
                      border: `1.5px solid ${claim === key ? C.green : C.border}`,
                      background: claim === key ? C.greenLight : "#fff",
                      color: claim === key ? C.greenDark : C.text,
                      fontFamily: GR,
                      fontWeight: 600,
                      fontSize: 12.5,
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {claim && (
                <p
                  style={{
                    fontFamily: IN,
                    fontSize: 11.5,
                    color: C.muted,
                    margin: "8px 0 0",
                    lineHeight: 1.45,
                  }}
                >
                  You will also upload a photo of your {DISCOUNTS[claim].idName}
                  . The discount applies automatically once TODA staff check it.
                </p>
              )}
            </div>

            <Field
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
            <Field
              label="Password (at least 8 characters)"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            <Field
              label="Confirm password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        )}

        {step === "id" && (
          <CameraCapture
            key="id"
            facing="environment"
            hint="Place your ID flat, in good light"
            value={idPhoto}
            onChange={setIdPhoto}
          />
        )}

        {step === "discountId" && (
          <CameraCapture
            key="discountId"
            facing="environment"
            hint={`Place your ${discountIdName} flat, in good light`}
            value={discountIdPhoto}
            onChange={setDiscountIdPhoto}
          />
        )}

        {step === "selfie" && (
          <CameraCapture
            key="selfie"
            facing="user"
            stamp
            hint="Center your face in the frame"
            value={selfie}
            onChange={setSelfie}
          />
        )}

        {step === "review" && (
          <div>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              {reviewPhotos.map(([label, src]) => (
                <div key={label} style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontFamily: IN,
                      fontSize: 11.5,
                      color: C.muted,
                      margin: "0 0 4px",
                    }}
                  >
                    {label}
                  </p>
                  <img
                    src={src}
                    alt={label}
                    style={{
                      width: "100%",
                      aspectRatio: "4 / 3",
                      objectFit: "cover",
                      borderRadius: 10,
                    }}
                  />
                </div>
              ))}
            </div>
            <div
              style={{
                background: C.surface,
                borderRadius: 12,
                padding: "12px 14px",
                marginBottom: 14,
                fontFamily: IN,
                fontSize: 12,
                color: C.text,
                lineHeight: 1.5,
              }}
            >
              Your account will be <strong>temporary</strong> until TODA staff
              check your ID and selfie and make it permanent. You can sign in
              right away while you wait.
              {activeClaim && (
                <>
                  {" "}
                  Your <strong>{discountName} discount</strong> starts once they
                  confirm your {discountIdName}.
                </>
              )}
            </div>
            <label
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                fontFamily: IN,
                fontSize: 12,
                color: C.text,
                lineHeight: 1.5,
                marginBottom: 16,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }}
              />
              <span>
                {CONSENT_TEXT}
                {activeClaim ? CONSENT_DISCOUNT_TEXT : ""}
              </span>
            </label>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          {stepIndex > 0 && (
            <button
              type="button"
              onClick={back}
              disabled={submitting}
              style={{
                flex: "0 0 auto",
                padding: "14px 18px",
                borderRadius: 12,
                border: `1.5px solid ${C.border}`,
                background: "#fff",
                color: C.text,
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <ArrowLeft size={15} /> Back
            </button>
          )}
          {step !== "review" ? (
            <button
              type="button"
              onClick={next}
              style={{
                flex: 1,
                padding: "14px 0",
                borderRadius: 12,
                border: "none",
                background: C.green,
                color: "#fff",
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              Next <ArrowRight size={15} />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              style={{
                flex: 1,
                padding: "14px 0",
                borderRadius: 12,
                border: "none",
                background: submitting ? C.muted : C.green,
                color: "#fff",
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 14,
                cursor: submitting ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <CheckCircle size={16} />
              {submitting
                ? "Submitting..."
                : resubmit
                  ? "Resubmit for review"
                  : "Create account"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
