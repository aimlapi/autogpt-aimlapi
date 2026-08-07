import {
  Form,
  FormDescription,
  FormField,
} from "@/components/__legacy__/ui/form";
import { Button } from "@/components/atoms/Button/Button";
import { Input } from "@/components/atoms/Input/Input";
import { Text } from "@/components/atoms/Text/Text";
import { Dialog } from "@/components/molecules/Dialog/Dialog";
import {
  BlockIOCredentialsSubSchema,
  CredentialsMetaInput,
} from "@/lib/autogpt-server-api/types";
import { useAimlapiGetApiKey } from "@/hooks/useAimlapiGetApiKey";
import { useAPIKeyCredentialsModal } from "./useAPIKeyCredentialsModal";

type Props = {
  schema: BlockIOCredentialsSubSchema;
  open: boolean;
  onClose: () => void;
  onCredentialsCreate: (creds: CredentialsMetaInput) => void;
  siblingInputs?: Record<string, any>;
};

export function APIKeyCredentialsModal({
  schema,
  open,
  onClose,
  onCredentialsCreate,
  siblingInputs,
}: Props) {
  const {
    form,
    isLoading,
    isSubmitting,
    supportsApiKey,
    provider,
    providerName,
    schemaDescription,
    onSubmit,
  } = useAPIKeyCredentialsModal({ schema, siblingInputs, onCredentialsCreate });

  const isAimlapi = provider === "aiml_api";
  const { getApiKey, oauthStatus, oauthMessage } = useAimlapiGetApiKey((key) =>
    form.setValue("apiKey", key, { shouldValidate: true, shouldDirty: true }),
  );

  if (isLoading || !supportsApiKey) {
    return null;
  }

  return (
    <Dialog
      title={`Add new API key for ${providerName ?? ""}`}
      controlled={{
        isOpen: open,
        set: (isOpen) => {
          if (!isOpen) onClose();
        },
      }}
      onClose={onClose}
      styling={{
        maxWidth: isAimlapi ? "34rem" : "25rem",
      }}
    >
      <Dialog.Content>
        {schemaDescription && (
          <p className="mb-4 text-sm text-zinc-600">{schemaDescription}</p>
        )}

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-2 px-2"
          >
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <Input
                  id="title"
                  label="Name"
                  type="text"
                  placeholder="Enter a name for this API Key..."
                  {...field}
                />
              )}
            />
            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) =>
                isAimlapi ? (
                  <div className="flex flex-col gap-1.5">
                    <Text variant="large-medium" as="span" className="text-black">
                      API Key
                    </Text>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <Input
                          id="apiKey"
                          label="API Key"
                          hideLabel
                          type="password"
                          placeholder="Enter API Key..."
                          wrapperClassName="!mb-0"
                          {...field}
                        />
                      </div>
                      <span className="text-sm text-zinc-400">or</span>
                      <Button
                        type="button"
                        variant="primary"
                        size="large"
                        className="!h-[2.875rem] !min-w-[11.55rem] !rounded-xl"
                        onClick={getApiKey}
                        loading={oauthStatus === "authorizing"}
                        disabled={oauthStatus === "authorizing"}
                      >
                        Get API key
                      </Button>
                    </div>
                    {oauthStatus === "success" && oauthMessage ? (
                      <p className="text-sm font-medium text-green-600">
                        {oauthMessage}
                      </p>
                    ) : null}
                    {oauthStatus === "error" && oauthMessage ? (
                      <p className="text-sm font-medium text-red-600">
                        {oauthMessage}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <Input
                    id="apiKey"
                    label="API Key"
                    type="password"
                    placeholder="Enter API Key..."
                    hint={
                      schema.credentials_scopes ? (
                        <FormDescription>
                          Required scope(s) for this block:{" "}
                          {schema.credentials_scopes?.map((s, i, a) => (
                            <span key={i}>
                              <code className="text-xs font-bold">{s}</code>
                              {i < a.length - 1 && ", "}
                            </span>
                          ))}
                        </FormDescription>
                      ) : null
                    }
                    {...field}
                  />
                )
              }
            />

            <FormField
              control={form.control}
              name="expiresAt"
              render={({ field }) => (
                <Input
                  id="expiresAt"
                  label="Expiration Date"
                  type="datetime-local"
                  placeholder="Select expiration date..."
                  value={field.value}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value) {
                      const dateTime = new Date(value);
                      dateTime.setHours(0, 0, 0, 0);
                      const year = dateTime.getFullYear();
                      const month = String(dateTime.getMonth() + 1).padStart(
                        2,
                        "0",
                      );
                      const day = String(dateTime.getDate()).padStart(2, "0");
                      const normalizedValue = `${year}-${month}-${day}T00:00`;
                      field.onChange(normalizedValue);
                    } else {
                      field.onChange(value);
                    }
                  }}
                  onBlur={field.onBlur}
                  name={field.name}
                />
              )}
            />
            <Button
              type="submit"
              className="min-w-68"
              loading={isSubmitting}
              disabled={isSubmitting}
            >
              Add API Key
            </Button>
          </form>
        </Form>
      </Dialog.Content>
    </Dialog>
  );
}
