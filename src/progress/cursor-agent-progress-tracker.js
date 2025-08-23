import { BaseProgressTracker } from './base-progress-tracker.js';

/**
 * Progress tracker specifically designed for cursor-agent operations
 * Extends BaseProgressTracker with cursor-agent specific features:
 * - Enhanced token tracking with cost calculation
 * - Operation-specific progress formats
 * - Recursive operation progress tracking
 * - Real-time cursor-agent status feedback
 */
export class CursorAgentProgressTracker extends BaseProgressTracker {
	constructor(options = {}) {
		super({
			unitName: 'operation',
			numUnits: 1, // Default to single operation
			...options
		});

		// Cursor-agent specific properties
		this.operationType = options.operationType || 'cursor-agent';
		this.operationDescription =
			options.operationDescription || 'Processing request';
		this.currentPhase = 'initializing';
		this.totalCost = 0;
		this.currency = 'USD';
		this.estimatedCost = 0;
		this.isRecursive = options.isRecursive || false;
		this.recursiveDepth = 0;
		this.maxRecursiveDepth = options.maxRecursiveDepth || 1;

		// Phase tracking for complex operations
		this.phases = options.phases || [
			'Starting cursor-agent',
			'Processing request',
			'Generating response',
			'Finalizing'
		];
		this.currentPhaseIndex = 0;
	}

	/**
	 * Override to add cursor-agent specific initialization
	 */
	_initializeCustomProperties(options) {
		// Set up recursive operation tracking if needed
		if (this.isRecursive) {
			this.numUnits = this.maxRecursiveDepth;
			this.unitName = 'recursion';
		}
	}

	/**
	 * Custom time/tokens bar format for cursor-agent operations
	 */
	_getTimeTokensBarFormat() {
		if (this.isRecursive) {
			return '🤖 {clock} {elapsed} | Depth: {depth}/{maxDepth} | Tokens: {in}/{out} | Cost: ${cost} | {remaining}';
		}
		return '🤖 {clock} {elapsed} | Phase: {phase} | Tokens: {in}/{out} | Cost: ${cost} | {remaining}';
	}

	/**
	 * Custom progress bar format for cursor-agent operations
	 */
	_getProgressBarFormat() {
		if (this.isRecursive) {
			return '🔄 Recursive Operations |{bar}| {percentage}% ({operations})';
		}
		return '⚡ {operationType} |{bar}| {percentage}% ({operations})';
	}

	/**
	 * Custom payload for time/tokens bar updates
	 */
	_getCustomTimeTokensPayload() {
		const basePayload = {
			phase: this.currentPhase,
			cost: this.totalCost.toFixed(4),
			operationType: this.operationType
		};

		if (this.isRecursive) {
			return {
				...basePayload,
				depth: this.recursiveDepth,
				maxDepth: this.maxRecursiveDepth
			};
		}

		return basePayload;
	}

	/**
	 * Update progress with cursor-agent specific information
	 */
	updateProgress(completed, phase = null) {
		this.completedUnits = completed;

		if (phase) {
			this.currentPhase = phase;
		}

		// Update phase index based on phase name
		const phaseIndex = this.phases.indexOf(phase);
		if (phaseIndex >= 0) {
			this.currentPhaseIndex = phaseIndex;
		}

		// Update the progress bar
		if (this.progressBar) {
			const payload = {
				[this.unitNamePlural]: `${completed}/${this.numUnits}`,
				operationType: this.operationType
			};
			this.progressBar.update(completed, payload);
		}

		// Update time/tokens bar
		this._updateTimeTokensBar();
	}

	/**
	 * Update token usage with cost calculation
	 */
	updateTokensWithCost(
		tokensIn,
		tokensOut,
		inputCostPer1M = 0,
		outputCostPer1M = 0,
		isEstimate = false
	) {
		// Update base token tracking
		this.updateTokens(tokensIn, tokensOut, isEstimate);

		// Calculate cost
		if (inputCostPer1M > 0 || outputCostPer1M > 0) {
			const inputCost = ((tokensIn || 0) / 1_000_000) * inputCostPer1M;
			const outputCost = ((tokensOut || 0) / 1_000_000) * outputCostPer1M;
			this.totalCost = inputCost + outputCost;
		}

		if (isEstimate) {
			this.estimatedCost = this.totalCost;
		}
	}

	/**
	 * Advance to next phase automatically
	 */
	nextPhase() {
		if (this.currentPhaseIndex < this.phases.length - 1) {
			this.currentPhaseIndex++;
			this.currentPhase = this.phases[this.currentPhaseIndex];

			// Calculate progress based on phase completion
			const phaseProgress = this.currentPhaseIndex / (this.phases.length - 1);
			this.updateProgress(phaseProgress, this.currentPhase);
		}
	}

	/**
	 * Update recursive depth for recursive operations
	 */
	updateRecursiveDepth(depth) {
		this.recursiveDepth = depth;
		this.updateProgress(
			depth / this.maxRecursiveDepth,
			`Recursion depth ${depth}`
		);
	}

	/**
	 * Mark current phase as complete and advance
	 */
	completeCurrentPhase() {
		this.nextPhase();
	}

	/**
	 * Override progress fraction calculation for phase-based progress
	 */
	_getProgressFraction() {
		if (this.isRecursive) {
			return this.recursiveDepth / this.maxRecursiveDepth;
		}
		return this.currentPhaseIndex / Math.max(1, this.phases.length - 1);
	}

	/**
	 * Get comprehensive summary including cursor-agent specific metrics
	 */
	getSummary() {
		const baseSummary = super.getSummary();
		return {
			...baseSummary,
			operationType: this.operationType,
			operationDescription: this.operationDescription,
			currentPhase: this.currentPhase,
			phaseIndex: this.currentPhaseIndex,
			totalPhases: this.phases.length,
			tokensIn: this.tokensIn,
			tokensOut: this.tokensOut,
			totalCost: this.totalCost,
			estimatedCost: this.estimatedCost,
			currency: this.currency,
			isRecursive: this.isRecursive,
			recursiveDepth: this.recursiveDepth,
			maxRecursiveDepth: this.maxRecursiveDepth
		};
	}

	/**
	 * Complete the operation successfully
	 */
	complete(finalMessage = 'Operation completed successfully') {
		this.currentPhase = finalMessage;
		this.completedUnits = this.numUnits;

		if (this.progressBar) {
			this.progressBar.update(this.numUnits, {
				[this.unitNamePlural]: `${this.numUnits}/${this.numUnits}`,
				operationType: this.operationType
			});
		}

		this._updateTimeTokensBar();

		// Stop after a brief delay to show completion
		setTimeout(() => this.stop(), 500);
	}

	/**
	 * Handle operation error
	 */
	error(errorMessage = 'Operation failed') {
		this.currentPhase = `❌ ${errorMessage}`;
		this._updateTimeTokensBar();

		// Stop immediately on error
		setTimeout(() => this.stop(), 1000);
	}

	/**
	 * Custom cleanup for cursor-agent specific resources
	 */
	_performCustomCleanup() {
		// Reset cursor-agent specific state
		this.currentPhase = 'completed';
		this.recursiveDepth = 0;
		this.totalCost = 0;
		this.estimatedCost = 0;
	}
}

/**
 * Factory function to create cursor-agent progress trackers with common configurations
 */
export function createCursorAgentProgressTracker(options = {}) {
	const defaultOptions = {
		operationType: 'cursor-agent',
		operationDescription: 'Processing cursor-agent request',
		phases: [
			'Initializing cursor-agent',
			'Parsing request',
			'Generating response',
			'Processing output',
			'Finalizing'
		]
	};

	return new CursorAgentProgressTracker({ ...defaultOptions, ...options });
}

/**
 * Factory function for recursive operation progress tracking
 */
export function createRecursiveCursorAgentProgressTracker(
	maxDepth = 3,
	operationType = 'recursive-expand'
) {
	return new CursorAgentProgressTracker({
		operationType,
		operationDescription: `Recursive ${operationType} operation`,
		isRecursive: true,
		maxRecursiveDepth: maxDepth,
		numUnits: maxDepth,
		unitName: 'recursion',
		phases: [
			'Starting recursive operation',
			'Processing recursively',
			'Optimizing results',
			'Finalizing recursive workflow'
		]
	});
}
