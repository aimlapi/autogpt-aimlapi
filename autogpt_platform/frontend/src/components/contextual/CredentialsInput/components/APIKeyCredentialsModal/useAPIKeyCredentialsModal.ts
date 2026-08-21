import useCredentials from "@/hooks/useCredentials";
import { validateAimlapiApiKey } from "@/hooks/useAimlapiGetApiKey";
import { toast } from "@/components/molecules/Toast/use-toast";
import {
  BlockIOCredentialsSubSchema,
  CredentialsMetaInput,
} from "@/lib/autogpt-server-api/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { z } from "zod";

export type APIKeyFormValues = {
  apiKey: string;
  title: string;
  expiresAt?: string;
};

type Args = {
  schema: BlockIOCredentialsSubSchema;
  siblingInputs?: Record<string, any>;
  onCredentialsCreate: (creds: CredentialsMetaInput) => void;
};

export function useAPIKeyCredentialsModal({
  schema,
  siblingInputs,
  onCredentialsCreate,
}: Args): {
  form: UseFormReturn<APIKeyFormValues>;
  isLoading: boolean;
  isSubmitting: boolean;
  supportsApiKey: boolean;
  provider?: string;
  providerName?: string;
  schemaDescription?: string;
  onSubmit: (values: APIKeyFormValues) => Promise<void>;
} {
  const credentials = useCredentials(schema, siblingInputs);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formSchema = z.object({
    apiKey: z.string().min(1, "API Key is required"),
    title: z.string().min(1, "Name is required"),
    expiresAt: z.string().optional(),
  });

  const form = useForm<APIKeyFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      apiKey: "",
      title: "",
      expiresAt: "",
    },
  });

  async function onSubmit(values: APIKeyFormValues) {
    if (!credentials || credentials.isLoading) return;
    setIsSubmitting(true);
    try {
      if (
        credentials.provider === "aiml_api" &&
        !(await validateAimlapiApiKey(values.apiKey))
      ) {
        form.setError("apiKey", {
          message: "This aimlapi.com API key is invalid.",
        });
        toast({
          title: "Invalid API key",
          description: "This aimlapi.com API key is invalid.",
          variant: "destructive",
        });
        return;
      }

      const expiresAt = values.expiresAt
        ? new Date(values.expiresAt).getTime() / 1000
        : undefined;
      const newCredentials = await credentials.createAPIKeyCredentials({
        api_key: values.apiKey,
        title: values.title,
        expires_at: expiresAt,
      });
      onCredentialsCreate({
        provider: credentials.provider,
        id: newCredentials.id,
        type: "api_key",
        title: newCredentials.title,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return {
    form,
    isLoading: !credentials || credentials.isLoading,
    isSubmitting,
    supportsApiKey: !!credentials?.supportsApiKey,
    provider: credentials?.provider,
    providerName:
      !credentials || credentials.isLoading
        ? undefined
        : credentials.providerName,
    schemaDescription: schema.description,
    onSubmit,
  };
}
