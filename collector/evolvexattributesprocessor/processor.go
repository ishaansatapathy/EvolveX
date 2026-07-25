// Feature #2 — Evolvex OTel Collector processor (enriches spans with incident/deploy context).
package evolvexattributesprocessor

import (
	"context"
	"os"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/collector/processor"
	"go.uber.org/zap"
)

const (
	TypeStr   = "evolvexattributes"
	stability = component.StabilityLevelDevelopment
)

var processorCapabilities = consumer.Capabilities{MutatesData: true}

type Config struct {
	IncidentID     string `mapstructure:"incident_id"`
	GitSha         string `mapstructure:"git_sha"`
	DeployVersion  string `mapstructure:"deploy_version"`
	Namespace      string `mapstructure:"namespace"`
	SamplingMode   string `mapstructure:"sampling_mode"`
	SamplingRate   string `mapstructure:"sampling_rate"`
	OrganizationID string `mapstructure:"organization_id"`
}

func createDefaultConfig() component.Config {
	return &Config{}
}

func createProcessor(
	_ context.Context,
	set processor.Settings,
	cfg component.Config,
	next consumer.Traces,
) (processor.Traces, error) {
	config := cfg.(*Config)
	return &enrichmentProcessor{logger: set.Logger, cfg: config, next: next}, nil
}

type enrichmentProcessor struct {
	logger *zap.Logger
	cfg    *Config
	next   consumer.Traces
}

func (p *enrichmentProcessor) Capabilities() consumer.Capabilities {
	return processorCapabilities
}

func (p *enrichmentProcessor) Start(_ context.Context, _ component.Host) error {
	return nil
}

func (p *enrichmentProcessor) Shutdown(_ context.Context) error {
	return nil
}

func (p *enrichmentProcessor) ConsumeTraces(ctx context.Context, td ptrace.Traces) error {
	attrs := map[string]string{
		"evolvex.incident_id":     firstNonEmpty(p.cfg.IncidentID, os.Getenv("EVOLVEX_INCIDENT_ID")),
		"evolvex.git_sha":         firstNonEmpty(p.cfg.GitSha, os.Getenv("EVOLVEX_GIT_SHA")),
		"evolvex.deploy_version":  firstNonEmpty(p.cfg.DeployVersion, os.Getenv("EVOLVEX_DEPLOY_VERSION")),
		"evolvex.namespace":       firstNonEmpty(p.cfg.Namespace, os.Getenv("EVOLVEX_NAMESPACE")),
		"evolvex.sampling_mode":   firstNonEmpty(p.cfg.SamplingMode, os.Getenv("EVOLVEX_SAMPLING_MODE")),
		"evolvex.sampling_rate":   firstNonEmpty(p.cfg.SamplingRate, os.Getenv("EVOLVEX_SAMPLING_RATE")),
		"evolvex.organization_id": firstNonEmpty(p.cfg.OrganizationID, os.Getenv("EVOLVEX_ORGANIZATION_ID")),
	}

	for i := 0; i < td.ResourceSpans().Len(); i++ {
		rs := td.ResourceSpans().At(i)
		resourceAttrs := rs.Resource().Attributes()
		for key, value := range attrs {
			if value == "" {
				continue
			}
			resourceAttrs.PutStr(key, value)
		}

		for j := 0; j < rs.ScopeSpans().Len(); j++ {
			ss := rs.ScopeSpans().At(j)
			for k := 0; k < ss.Spans().Len(); k++ {
				span := ss.Spans().At(k)
				spanAttrs := span.Attributes()
				for key, value := range attrs {
					if value == "" {
						continue
					}
					spanAttrs.PutStr(key, value)
				}
			}
		}
	}

	return p.next.ConsumeTraces(ctx, td)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func NewFactory() processor.Factory {
	return processor.NewFactory(
		TypeStr,
		createDefaultConfig,
		processor.WithTraces(createProcessor, stability),
	)
}
